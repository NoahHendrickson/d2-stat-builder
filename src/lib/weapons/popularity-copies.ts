/**
 * The copy store behind perk popularity: every copy of a legendary weapon the
 * crawler has seen, once each, keyed by its item instance id, with the perk in
 * each column and the day it was last seen. A copy seen again replaces its
 * earlier record, so a player who turns up in many crawls still counts each of
 * their weapons once; a copy not seen for --days drops out. The snapshot the
 * app reads is the store tallied (snapshotFromCopies).
 *
 * Pure data, no Node: the file format is scripts/copy-store-file.ts. Nothing
 * about a player is in it: an instance id only leads back to its owner
 * through their profile, and everything stored was public on that profile.
 */

import {
  comboKey,
  traitColumns,
  type CrawlSource,
  type MergedPopularity,
  type WeaponPopularity,
} from "./perk-popularity";

/** One weapon's copies, sorted by id. Parallel arrays, so millions of copies stay compact. */
export interface WeaponCopies {
  /** How many columns each copy has a pick for: the catalog's column count. */
  columns: number;
  /** Base perk hashes the picks index into. */
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
  /** The crawls whose copies are in it, oldest first; `generatedAt` tells them apart. */
  runs: CrawlSource[];
}

/** A weapon's catalog columns, by hash; undefined for a weapon the catalog doesn't have. */
export type CatalogColumns = (hash: number) => readonly { kind: string }[] | undefined;

/** A pick for a column whose perk wasn't identified. */
export const UNKNOWN = 255;

/** Today, or the day `ms` falls on, as a store day (UTC). */
export const storeDay = (ms = Date.now()) => Math.floor(ms / 86_400_000);

export const emptyStore = (): CopyStore => ({ weapons: new Map(), runs: [] });

export const copyCount = (store: CopyStore) =>
  [...store.weapons.values()].reduce((sum, weapon) => sum + weapon.ids.length, 0);

/** Room for `length` copies of a weapon with `columns` columns. */
export function allocWeapon(columns: number, perks: number[], length: number): WeaponCopies {
  return {
    columns,
    perks,
    ids: new BigUint64Array(length),
    seen: new Uint16Array(length),
    picks: new Uint8Array(length * columns).fill(UNKNOWN),
  };
}

/**
 * Copies `from`'s copy `i` into `to`'s row `k`, its picks through `remap`
 * (`from`'s perk index → `to`'s) when the two have different perk tables.
 */
function copyRow(from: WeaponCopies, i: number, to: WeaponCopies, k: number, remap?: readonly number[]) {
  to.ids[k] = from.ids[i]!;
  to.seen[k] = from.seen[i]!;
  const { columns } = from;
  for (let column = 0; column < columns; column++) {
    const pick = from.picks[i * columns + column]!;
    to.picks[k * columns + column] = pick === UNKNOWN || !remap ? pick : remap[pick]!;
  }
}

/** The first `length` rows of `weapon`, in arrays of their own. */
const trimmed = (weapon: WeaponCopies, length: number): WeaponCopies => ({
  ...weapon,
  ids: weapon.ids.slice(0, length),
  seen: weapon.seen.slice(0, length),
  picks: weapon.picks.slice(0, length * weapon.columns),
});

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

/** One copy as the crawler hands it over: its instance id and base perk per catalog column. */
export interface SeenCopy {
  id: bigint;
  perks: readonly (number | undefined)[];
}

/** One crawl's copies as a store, every one seen on `day`. */
export function storeFromCopies(copies: ReadonlyMap<number, readonly SeenCopy[]>, day: number, run: CrawlSource): CopyStore {
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, list] of copies) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const indexOf = new Map<number, number>();
    const weapon = allocWeapon(sorted[0]!.perks.length, [], sorted.length);
    weapon.seen.fill(day);
    sorted.forEach((copy, k) => {
      weapon.ids[k] = copy.id;
      copy.perks.forEach((perk, column) => {
        if (perk !== undefined) weapon.picks[k * weapon.columns + column] = pickFor(perk, weapon.perks, indexOf);
      });
    });
    weapons.set(hash, weapon);
  }
  return { weapons, runs: [run] };
}

/**
 * `older` and `newer` as one store, against the catalog: this is the one place
 * copies are held to it, so a weapon gone from the catalog, or whose column
 * count has changed since a side's copies were seen, loses that side's copies
 * (they come back as they're seen again), and the store that comes out always
 * lines up with `columnsOf`.
 * A copy in both keeps the record seen on the later day (`newer`'s on the same
 * day), and where that record has a column unidentified, the other's pick for
 * it. A `newer` whose crawls are all in `older` already (a crawl file merged
 * twice) changes nothing but the catalog check.
 */
export function mergeCopies(older: CopyStore, newer: CopyStore, columnsOf: CatalogColumns): CopyStore {
  const applied = new Set(older.runs.map((run) => run.generatedAt));
  const fresh = newer.runs.filter((run) => !applied.has(run.generatedAt));
  const adding = fresh.length > 0 ? newer.weapons : new Map<number, WeaponCopies>();
  const weapons = new Map<number, WeaponCopies>();
  for (const hash of new Set([...older.weapons.keys(), ...adding.keys()])) {
    const columns = columnsOf(hash)?.length;
    const fits = (weapon: WeaponCopies | undefined) => (weapon?.columns === columns ? weapon : undefined);
    const a = fits(older.weapons.get(hash));
    const b = fits(adding.get(hash));
    const merged = a && b ? mergeWeapon(a, b) : (a ?? b);
    if (merged) weapons.set(hash, merged);
  }
  return { weapons, runs: [...older.runs, ...fresh] };
}

function mergeWeapon(a: WeaponCopies, b: WeaponCopies): WeaponCopies {
  const { columns } = a;
  const perks: number[] = [];
  const indexOf = new Map<number, number>();
  const remapA = a.perks.map((perk) => pickFor(perk, perks, indexOf));
  const remapB = b.perks.map((perk) => pickFor(perk, perks, indexOf));
  // A merge join of the two sorted id lists into room for both, trimmed after.
  const out = allocWeapon(columns, perks, a.ids.length + b.ids.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.ids.length || j < b.ids.length) {
    if (j >= b.ids.length || (i < a.ids.length && a.ids[i]! < b.ids[j]!)) copyRow(a, i++, out, k++, remapA);
    else if (i >= a.ids.length || b.ids[j]! < a.ids[i]!) copyRow(b, j++, out, k++, remapB);
    else {
      // The same copy: the later sighting, its gaps filled from the other.
      const aLater = a.seen[i]! > b.seen[j]!;
      copyRow(aLater ? a : b, aLater ? i : j, out, k, aLater ? remapA : remapB);
      const [other, at, remap] = aLater ? [b, j, remapB] : [a, i, remapA];
      for (let column = 0; column < columns; column++) {
        const pick = other.picks[at * columns + column]!;
        if (out.picks[k * columns + column] === UNKNOWN && pick !== UNKNOWN)
          out.picks[k * columns + column] = remap[pick]!;
      }
      i++;
      j++;
      k++;
    }
  }
  return trimmed(out, k);
}

/**
 * The store without copies last seen before `firstDay`, and without runs that
 * finished before it. A weapon left with no copies is dropped.
 */
export function pruneCopies(store: CopyStore, firstDay: number): CopyStore {
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, weapon] of store.weapons) {
    const kept = allocWeapon(weapon.columns, weapon.perks, weapon.ids.length);
    let k = 0;
    weapon.seen.forEach((day, i) => {
      if (day >= firstDay) copyRow(weapon, i, kept, k++);
    });
    if (k > 0) weapons.set(hash, k === weapon.ids.length ? weapon : trimmed(kept, k));
  }
  return { weapons, runs: store.runs.filter((run) => storeDay(Date.parse(run.generatedAt)) >= firstDay) };
}

/**
 * The tally the app reads: per weapon, its copies, each column's perks and the
 * left + right trait combo. `store` must have come through mergeCopies with
 * the same catalog, so every weapon lines up with it.
 */
export function tallyCopies(store: CopyStore, columnsOf: CatalogColumns): Record<string, WeaponPopularity> {
  const tally: Record<string, WeaponPopularity> = {};
  for (const [hash, weapon] of store.weapons) {
    const { columns, perks, picks } = weapon;
    const catalog = columnsOf(hash);
    if (catalog?.length !== columns)
      throw new Error(`Weapon ${hash} has ${columns} columns in the store but not in the catalog; merge first.`);
    const counts = Array.from({ length: columns }, () => new Uint32Array(perks.length));
    const traits = traitColumns(catalog);
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
  columnsOf: CatalogColumns,
  generatedAt = new Date().toISOString(),
): MergedPopularity {
  const { runs } = store;
  return {
    schema: 2,
    generatedAt,
    from: runs.map((run) => run.from).sort()[0] ?? "",
    to: runs.map((run) => run.to).sort().at(-1) ?? "",
    players: runs.reduce((sum, run) => sum + run.players, 0),
    weapons: tallyCopies(store, columnsOf),
    crawls: runs,
  };
}
