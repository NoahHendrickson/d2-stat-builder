/**
 * The copy store behind perk popularity: every copy of a legendary weapon the
 * crawler has seen, once each, keyed by its item instance id, with the perk in
 * each column and the day it was last seen. A copy seen again (in a later
 * crawl, or by another route the same day) replaces its earlier record, so a
 * player who turns up in many crawls still counts each of their weapons once;
 * a copy not seen for --days drops out. The snapshot the app reads is the
 * store tallied (tallyCopies).
 *
 * Kept as one gzipped binary file (encodeCopies) in a release of the data repo:
 * millions of copies, which JSON in git couldn't carry. Nothing about a player
 * is in it: an instance id only leads back to its owner through their profile,
 * and everything stored was public on that profile anyway.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { comboKey, type CrawlSource, type MergedPopularity, type WeaponPopularity } from "./perk-popularity";

/** One weapon's copies, sorted by id. Parallel arrays, so millions of copies stay compact. */
export interface WeaponCopies {
  /** How many columns each copy has a perk for (the catalog's column count when it was seen). */
  columns: number;
  /** Base perk hashes the copies' perks index into. */
  perks: number[];
  ids: BigUint64Array;
  /** The UTC day (days since 1970-01-01) each copy was last seen. */
  seen: Uint16Array;
  /** Per copy, `columns` indices into `perks`; UNKNOWN where the column's perk wasn't identified. */
  picks: Uint8Array;
}

export interface CopyStore {
  /** By weapon item hash. */
  weapons: Map<number, WeaponCopies>;
  /** The crawls whose copies are in it, oldest first. */
  runs: CrawlSource[];
}

/** A pick for a column whose perk wasn't identified. */
const UNKNOWN = 255;

/** Today, or the day `ms` falls on, as a store day (UTC). */
export const storeDay = (ms = Date.now()) => Math.floor(ms / 86_400_000);

export const emptyStore = (): CopyStore => ({ weapons: new Map(), runs: [] });

/** One copy as the crawler hands it over: its instance id and base perk per column. */
export interface SeenCopy {
  id: bigint;
  perks: readonly (number | undefined)[];
}

/**
 * One crawl's copies as a store, every one seen on `day`. A copy that shows up
 * twice (it can't, from one profile read, but cheap to be sure) keeps its last.
 */
export function storeFromCopies(
  copies: ReadonlyMap<number, readonly SeenCopy[]>,
  day: number,
  run?: CrawlSource,
): CopyStore {
  const store = emptyStore();
  for (const [hash, list] of copies) {
    if (list.length === 0) continue;
    const columns = list[0]!.perks.length;
    const byId = new Map<bigint, SeenCopy>();
    for (const copy of list) if (copy.perks.length === columns) byId.set(copy.id, copy);
    const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const perks: number[] = [];
    const indexOf = new Map<number, number>();
    const weapon: WeaponCopies = {
      columns,
      perks,
      ids: new BigUint64Array(sorted.length),
      seen: new Uint16Array(sorted.length).fill(day),
      picks: new Uint8Array(sorted.length * columns),
    };
    sorted.forEach((copy, i) => {
      weapon.ids[i] = copy.id;
      copy.perks.forEach((perk, column) => {
        weapon.picks[i * columns + column] = perk === undefined ? UNKNOWN : pickFor(perk, perks, indexOf);
      });
    });
    store.weapons.set(hash, weapon);
  }
  if (run) store.runs.push(run);
  return store;
}

/** `perk`'s index in `perks`, added if it's new. */
function pickFor(perk: number, perks: number[], indexOf: Map<number, number>) {
  let index = indexOf.get(perk);
  if (index === undefined) {
    if (perks.length >= UNKNOWN) throw new Error(`More than ${UNKNOWN} perks on one weapon.`);
    index = perks.length;
    perks.push(perk);
    indexOf.set(perk, index);
  }
  return index;
}

/**
 * `older` and `newer` as one store: every copy once, a copy in both taking
 * `newer`'s record (its perks may have changed, and it was seen later). A
 * weapon whose column count differs between the two (the catalog changed in
 * between) keeps only `newer`'s copies; the rest come back as they're seen
 * again. `newer`'s runs follow `older`'s, a run in both (the same crawl file
 * merged twice) listed once, in `newer`'s place.
 */
export function mergeCopies(older: CopyStore, newer: CopyStore): CopyStore {
  const weapons = new Map(older.weapons);
  for (const [hash, b] of newer.weapons) {
    const a = older.weapons.get(hash);
    weapons.set(hash, a && a.columns === b.columns ? mergeWeapon(a, b) : b);
  }
  const again = new Set(newer.runs.map((run) => run.file));
  return { weapons, runs: [...older.runs.filter((run) => !again.has(run.file)), ...newer.runs] };
}

function mergeWeapon(a: WeaponCopies, b: WeaponCopies): WeaponCopies {
  const { columns } = a;
  const perks: number[] = [];
  const indexOf = new Map<number, number>();
  const remapA = a.perks.map((perk) => pickFor(perk, perks, indexOf));
  const remapB = b.perks.map((perk) => pickFor(perk, perks, indexOf));
  // A merge join of the two sorted id lists, walked twice: once to size the
  // result, once to fill it. On a tie b's record wins.
  const join = (visit: (from: WeaponCopies, at: number, remap: number[]) => void) => {
    let i = 0;
    let j = 0;
    while (i < a.ids.length || j < b.ids.length) {
      if (j >= b.ids.length || (i < a.ids.length && a.ids[i]! < b.ids[j]!)) visit(a, i++, remapA);
      else {
        if (i < a.ids.length && a.ids[i] === b.ids[j]) i++;
        visit(b, j++, remapB);
      }
    }
  };
  let length = 0;
  join(() => length++);
  const merged: WeaponCopies = {
    columns,
    perks,
    ids: new BigUint64Array(length),
    seen: new Uint16Array(length),
    picks: new Uint8Array(length * columns),
  };
  let k = 0;
  join((from, at, remap) => {
    merged.ids[k] = from.ids[at]!;
    merged.seen[k] = from.seen[at]!;
    for (let column = 0; column < columns; column++) {
      const pick = from.picks[at * columns + column]!;
      merged.picks[k * columns + column] = pick === UNKNOWN ? UNKNOWN : remap[pick]!;
    }
    k++;
  });
  return merged;
}

/**
 * The store without copies last seen before `firstDay`, and without runs that
 * finished before it. A weapon left with no copies is dropped.
 */
export function pruneCopies(store: CopyStore, firstDay: number): CopyStore {
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, weapon] of store.weapons) {
    const keep: number[] = [];
    weapon.seen.forEach((day, i) => {
      if (day >= firstDay) keep.push(i);
    });
    if (keep.length === 0) continue;
    if (keep.length === weapon.ids.length) {
      weapons.set(hash, weapon);
      continue;
    }
    const { columns } = weapon;
    const kept: WeaponCopies = {
      columns,
      perks: weapon.perks,
      ids: new BigUint64Array(keep.length),
      seen: new Uint16Array(keep.length),
      picks: new Uint8Array(keep.length * columns),
    };
    keep.forEach((i, k) => {
      kept.ids[k] = weapon.ids[i]!;
      kept.seen[k] = weapon.seen[i]!;
      kept.picks.set(weapon.picks.subarray(i * columns, (i + 1) * columns), k * columns);
    });
    weapons.set(hash, kept);
  }
  return { weapons, runs: store.runs.filter((run) => storeDay(Date.parse(run.generatedAt)) >= firstDay) };
}

export const copyCount = (store: CopyStore) =>
  [...store.weapons.values()].reduce((sum, weapon) => sum + weapon.ids.length, 0);

/**
 * The tally the app reads: per weapon, its copies, each column's perks and
 * the left + right trait combo, counted from the store. `columnsOf` gives a
 * weapon's catalog column count and `traitsOf` its trait columns (see
 * traitColumns); a weapon no longer in the catalog, or whose column count has
 * changed since its copies were seen, is left out until it's seen again.
 */
export function tallyCopies(
  store: CopyStore,
  columnsOf: (hash: number) => number | undefined,
  traitsOf: (hash: number) => readonly [number, number] | undefined,
): Record<string, WeaponPopularity> {
  const tally: Record<string, WeaponPopularity> = {};
  for (const [hash, weapon] of store.weapons) {
    const { columns, perks, picks } = weapon;
    if (columnsOf(hash) !== columns) continue;
    const counts = Array.from({ length: columns }, () => new Uint32Array(perks.length));
    const traits = traitsOf(hash);
    const combos = new Map<number, number>();
    for (let copy = 0; copy < weapon.ids.length; copy++) {
      const row = copy * columns;
      for (let column = 0; column < columns; column++) {
        const pick = picks[row + column]!;
        if (pick !== UNKNOWN) counts[column]![pick]!++;
      }
      if (traits) {
        const left = picks[row + traits[0]]!;
        const right = picks[row + traits[1]]!;
        if (left !== UNKNOWN && right !== UNKNOWN) {
          const key = left * 256 + right;
          combos.set(key, (combos.get(key) ?? 0) + 1);
        }
      }
    }
    const popularity: WeaponPopularity = {
      copies: weapon.ids.length,
      columns: counts.map((column) => {
        const byHash: Record<string, number> = {};
        column.forEach((n, pick) => {
          if (n > 0) byHash[perks[pick]!] = n;
        });
        return byHash;
      }),
    };
    if (traits) {
      popularity.combos = {};
      for (const [key, n] of combos)
        popularity.combos[comboKey(perks[Math.floor(key / 256)]!, perks[key % 256]!)] = n;
    }
    tally[hash] = popularity;
  }
  return tally;
}

/**
 * The snapshot the app reads: the store tallied (see tallyCopies), spanning
 * its crawls' matches, their players added up, and the crawls listed.
 */
export function snapshotFromCopies(
  store: CopyStore,
  columnsOf: (hash: number) => number | undefined,
  traitsOf: (hash: number) => readonly [number, number] | undefined,
  generatedAt = new Date().toISOString(),
): MergedPopularity {
  const { runs } = store;
  return {
    schema: 2,
    generatedAt,
    from: runs.map((run) => run.from).sort()[0] ?? "",
    to: runs.map((run) => run.to).sort().at(-1) ?? "",
    players: runs.reduce((sum, run) => sum + run.players, 0),
    weapons: tallyCopies(store, columnsOf, traitsOf),
    crawls: runs,
  };
}

/** "D2PC": the file's first four bytes. */
const MAGIC = 0x43503244;
const VERSION = 1;

/**
 * The store as a gzipped file. Little-endian throughout: magic, version, a
 * JSON header (the runs), then each weapon: hash, column count, perk table,
 * copy count, then its ids, last-seen days and picks.
 */
export function encodeCopies(store: CopyStore): Buffer {
  const header = Buffer.from(JSON.stringify({ runs: store.runs }));
  let size = 4 + 1 + 4 + header.length + 4;
  for (const weapon of store.weapons.values())
    size += 4 + 1 + 1 + weapon.perks.length * 4 + 4 + weapon.ids.length * (8 + 2 + weapon.columns);
  const out = Buffer.alloc(size);
  let at = 0;
  at = out.writeUInt32LE(MAGIC, at);
  at = out.writeUInt8(VERSION, at);
  at = out.writeUInt32LE(header.length, at);
  at += header.copy(out, at);
  at = out.writeUInt32LE(store.weapons.size, at);
  for (const [hash, weapon] of store.weapons) {
    at = out.writeUInt32LE(hash, at);
    at = out.writeUInt8(weapon.columns, at);
    at = out.writeUInt8(weapon.perks.length, at);
    for (const perk of weapon.perks) at = out.writeUInt32LE(perk, at);
    at = out.writeUInt32LE(weapon.ids.length, at);
    for (const id of weapon.ids) at = out.writeBigUInt64LE(id, at);
    for (const day of weapon.seen) at = out.writeUInt16LE(day, at);
    out.set(weapon.picks, at);
    at += weapon.picks.length;
  }
  return gzipSync(out);
}

export function decodeCopies(file: Buffer): CopyStore {
  const data = gunzipSync(file);
  let at = 0;
  if (data.readUInt32LE(at) !== MAGIC) throw new Error("Not a copy store.");
  at += 4;
  const version = data.readUInt8(at++);
  if (version !== VERSION) throw new Error(`Copy store version ${version}; this reads ${VERSION}.`);
  const headerLength = data.readUInt32LE(at);
  at += 4;
  const header = JSON.parse(data.toString("utf8", at, at + headerLength)) as { runs: CrawlSource[] };
  at += headerLength;
  const weapons = new Map<number, WeaponCopies>();
  const count = data.readUInt32LE(at);
  at += 4;
  for (let w = 0; w < count; w++) {
    const hash = data.readUInt32LE(at);
    const columns = data.readUInt8(at + 4);
    const perkCount = data.readUInt8(at + 5);
    at += 6;
    const perks = Array.from({ length: perkCount }, (_, i) => data.readUInt32LE(at + i * 4));
    at += perkCount * 4;
    const copies = data.readUInt32LE(at);
    at += 4;
    const ids = new BigUint64Array(copies);
    for (let i = 0; i < copies; i++, at += 8) ids[i] = data.readBigUInt64LE(at);
    const seen = new Uint16Array(copies);
    for (let i = 0; i < copies; i++, at += 2) seen[i] = data.readUInt16LE(at);
    const picks = Uint8Array.from(data.subarray(at, at + copies * columns));
    at += copies * columns;
    weapons.set(hash, { columns, perks, ids, seen, picks });
  }
  return { weapons, runs: header.runs };
}
