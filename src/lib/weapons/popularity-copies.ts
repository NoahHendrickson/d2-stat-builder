/**
 * The copy store behind perk popularity: every copy of a legendary weapon the
 * crawler has seen, once each, keyed by its item instance id, with the perk in
 * each column and the player it belongs to. A copy seen again replaces its
 * earlier record. A player's copies count for as long as they keep playing:
 * each crawl re-reads players it hasn't read for a while (dueOwners), which
 * refreshes their copies and when they last played, and a player who hasn't
 * played for --days drops out with all their copies (pruneCopies). The
 * snapshot the app reads is the store tallied (snapshotFromCopies).
 *
 * Pure data, no Node: the file format is scripts/copy-store-file.ts, which
 * encrypts it, since the store lists the players it found.
 */

import {
  comboKey,
  traitColumns,
  type CrawlSource,
  type MergedPopularity,
  type WeaponPopularity,
} from "./perk-popularity";

/** The players whose copies are in the store, as parallel arrays: owner n is index n of each. */
export interface Owners {
  /** Bungie membership id. */
  ids: BigUint64Array;
  /** Bungie membership type (platform), which a profile read needs alongside the id. */
  types: Uint8Array;
  /** The UTC day (days since 1970-01-01) they last played, as of our last read. */
  played: Uint16Array;
  /** The day we last read their profile. */
  read: Uint16Array;
  /** 1 when that read saw their vault and inventories, so it listed every copy they have. */
  whole: Uint8Array;
}

/** One weapon's copies, sorted by id. Parallel arrays, so millions of copies stay compact. */
export interface WeaponCopies {
  /** How many columns each copy has a pick for: the catalog's column count. */
  columns: number;
  /** Base perk hashes the picks index into. */
  perks: number[];
  ids: BigUint64Array;
  /** The day each copy was last seen. */
  seen: Uint16Array;
  /** Each copy's owner, an index into the store's Owners. */
  owners: Uint32Array;
  /** Per copy, `columns` indices into `perks`; UNKNOWN where the column's perk wasn't identified. */
  picks: Uint8Array;
}

export interface CopyStore {
  owners: Owners;
  /** By weapon item hash. */
  weapons: Map<number, WeaponCopies>;
  /** The crawls of the last --days, oldest first; `generatedAt` tells them apart. */
  runs: CrawlSource[];
}

/** A weapon's catalog columns, by hash; undefined for a weapon the catalog doesn't have. */
export type CatalogColumns = (hash: number) => readonly { kind: string }[] | undefined;

/** A pick for a column whose perk wasn't identified. */
export const UNKNOWN = 255;

/** Today, or the day `ms` falls on, as a store day (UTC). */
export const storeDay = (ms = Date.now()) => Math.floor(ms / 86_400_000);

export function allocOwners(length: number): Owners {
  return {
    ids: new BigUint64Array(length),
    types: new Uint8Array(length),
    played: new Uint16Array(length),
    read: new Uint16Array(length),
    whole: new Uint8Array(length),
  };
}

const OWNER_FIELDS = ["ids", "types", "played", "read", "whole"] as const;

/** Copies owner `i` of `from` into slot `k` of `to`. */
function copyOwner(from: Owners, i: number, to: Owners, k: number) {
  for (const field of OWNER_FIELDS) to[field][k] = from[field][i]!;
}

/** The first `length` owners, in arrays of their own. */
const trimmedOwners = (owners: Owners, length: number): Owners => ({
  ids: owners.ids.slice(0, length),
  types: owners.types.slice(0, length),
  played: owners.played.slice(0, length),
  read: owners.read.slice(0, length),
  whole: owners.whole.slice(0, length),
});

export const emptyStore = (): CopyStore => ({ owners: allocOwners(0), weapons: new Map(), runs: [] });

export const copyCount = (store: CopyStore) =>
  [...store.weapons.values()].reduce((sum, weapon) => sum + weapon.ids.length, 0);

/** Room for `length` copies of a weapon with `columns` columns. */
export function allocWeapon(columns: number, perks: number[], length: number): WeaponCopies {
  return {
    columns,
    perks,
    ids: new BigUint64Array(length),
    seen: new Uint16Array(length),
    owners: new Uint32Array(length),
    picks: new Uint8Array(length * columns).fill(UNKNOWN),
  };
}

/**
 * Copies `from`'s copy `i` into `to`'s row `k`, its picks through `perkMap`
 * (`from`'s perk index → `to`'s) and its owner through `ownerMap`, when given.
 */
function copyRow(
  from: WeaponCopies,
  i: number,
  to: WeaponCopies,
  k: number,
  perkMap?: readonly number[],
  ownerMap?: ArrayLike<number>,
) {
  to.ids[k] = from.ids[i]!;
  to.seen[k] = from.seen[i]!;
  to.owners[k] = ownerMap ? ownerMap[from.owners[i]!]! : from.owners[i]!;
  const { columns } = from;
  for (let column = 0; column < columns; column++) {
    const pick = from.picks[i * columns + column]!;
    to.picks[k * columns + column] = pick === UNKNOWN || !perkMap ? pick : perkMap[pick]!;
  }
}

/** The first `length` rows of `weapon`, in arrays of their own. */
const trimmed = (weapon: WeaponCopies, length: number): WeaponCopies => ({
  ...weapon,
  ids: weapon.ids.slice(0, length),
  seen: weapon.seen.slice(0, length),
  owners: weapon.owners.slice(0, length),
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

/** A player as the crawler read them. */
export interface SeenOwner {
  id: bigint;
  type: number;
  /** The day they last played. */
  played: number;
  /** Whether the read saw their vault and inventories, so it listed every copy they have. */
  whole: boolean;
}

/** One copy as the crawler hands it over: its instance id, its owner (an index into the crawl's owners) and base perk per catalog column. */
export interface SeenCopy {
  id: bigint;
  owner: number;
  perks: readonly (number | undefined)[];
}

/** One crawl as a store: its players, all read on `day`, and their copies, all seen that day. */
export function storeFromCrawl(
  owners: readonly SeenOwner[],
  copies: ReadonlyMap<number, readonly SeenCopy[]>,
  day: number,
  run: CrawlSource,
): CopyStore {
  const table = allocOwners(owners.length);
  owners.forEach((owner, k) => {
    table.ids[k] = owner.id;
    table.types[k] = owner.type;
    table.played[k] = owner.played;
    table.read[k] = day;
    table.whole[k] = owner.whole ? 1 : 0;
  });
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, list] of copies) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const indexOf = new Map<number, number>();
    const weapon = allocWeapon(sorted[0]!.perks.length, [], sorted.length);
    weapon.seen.fill(day);
    sorted.forEach((copy, k) => {
      weapon.ids[k] = copy.id;
      weapon.owners[k] = copy.owner;
      copy.perks.forEach((perk, column) => {
        if (perk !== undefined) weapon.picks[k * weapon.columns + column] = pickFor(perk, weapon.perks, indexOf);
      });
    });
    weapons.set(hash, weapon);
  }
  return { owners: table, weapons, runs: [run] };
}

/** Each owner's index, by membership id. */
export function ownerIndex(owners: Owners) {
  const index = new Map<bigint, number>();
  owners.ids.forEach((id, i) => index.set(id, i));
  return index;
}

/**
 * `older` and `newer` as one store, against the catalog: this is the one place
 * copies are held to it, so a weapon gone from the catalog, or whose column
 * count has changed since a side's copies were seen, loses that side's copies
 * (they come back as they're seen again), and the store that comes out always
 * lines up with `columnsOf`.
 * A player in both keeps the later read. A copy in both keeps the record seen
 * on the later day (`newer`'s on the same day), and where that record has a
 * column unidentified, the other's pick for it. A player whose later read saw
 * their whole inventory loses the older copies that read didn't list (they
 * dismantled them). A `newer` whose crawls are all in `older` already (a crawl
 * file merged twice) changes nothing but the catalog check.
 */
export function mergeCopies(older: CopyStore, newer: CopyStore, columnsOf: CatalogColumns): CopyStore {
  const applied = new Set(older.runs.map((run) => run.generatedAt));
  const fresh = newer.runs.filter((run) => !applied.has(run.generatedAt));
  const adding = fresh.length > 0 ? newer : emptyStore();

  // Owners: older's keep their indices; newer's are updated in place or appended.
  const index = ownerIndex(older.owners);
  const olderCount = older.owners.ids.length;
  const owners = allocOwners(olderCount + adding.owners.ids.length);
  for (let i = 0; i < olderCount; i++) copyOwner(older.owners, i, owners, i);
  let ownerCount = olderCount;
  const ownerMap = new Uint32Array(adding.owners.ids.length);
  /** Older owners whose newer read listed every copy they have, so older copies it missed are gone. */
  const replaced = new Set<number>();
  for (let i = 0; i < adding.owners.ids.length; i++) {
    const known = index.get(adding.owners.ids[i]!);
    const k = known ?? ownerCount++;
    ownerMap[i] = k;
    if (known === undefined || adding.owners.read[i]! >= owners.read[k]!) {
      copyOwner(adding.owners, i, owners, k);
      if (known !== undefined && adding.owners.whole[i]) replaced.add(k);
    }
  }

  const weapons = new Map<number, WeaponCopies>();
  for (const hash of new Set([...older.weapons.keys(), ...adding.weapons.keys()])) {
    const columns = columnsOf(hash)?.length;
    const fits = (weapon: WeaponCopies | undefined) => (weapon?.columns === columns ? weapon : undefined);
    const merged = mergeWeapon(fits(older.weapons.get(hash)), fits(adding.weapons.get(hash)), ownerMap, replaced);
    if (merged) weapons.set(hash, merged);
  }
  return { owners: trimmedOwners(owners, ownerCount), weapons, runs: [...older.runs, ...fresh] };
}

function mergeWeapon(
  a: WeaponCopies | undefined,
  b: WeaponCopies | undefined,
  ownerMap: Uint32Array,
  replaced: ReadonlySet<number>,
): WeaponCopies | undefined {
  if (!a && !b) return undefined;
  const columns = (a ?? b)!.columns;
  const perks: number[] = [];
  const indexOf = new Map<number, number>();
  const remapA = a?.perks.map((perk) => pickFor(perk, perks, indexOf)) ?? [];
  const remapB = b?.perks.map((perk) => pickFor(perk, perks, indexOf)) ?? [];
  const aLength = a?.ids.length ?? 0;
  const bLength = b?.ids.length ?? 0;
  // A merge join of the two sorted id lists into room for both, trimmed after.
  const out = allocWeapon(columns, perks, aLength + bLength);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < aLength || j < bLength) {
    if (j >= bLength || (i < aLength && a!.ids[i]! < b!.ids[j]!)) {
      // Only in the older store: gone if its owner's newer read listed everything and not it.
      if (!replaced.has(a!.owners[i]!)) copyRow(a!, i, out, k++, remapA);
      i++;
    } else if (i >= aLength || b!.ids[j]! < a!.ids[i]!) copyRow(b!, j++, out, k++, remapB, ownerMap);
    else {
      // The same copy: the later sighting, its gaps filled from the other.
      const aLater = a!.seen[i]! > b!.seen[j]!;
      if (aLater) copyRow(a!, i, out, k, remapA);
      else copyRow(b!, j, out, k, remapB, ownerMap);
      const [other, at, remap] = aLater ? [b!, j, remapB] : [a!, i, remapA];
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
  return k > 0 ? trimmed(out, k) : undefined;
}

/**
 * The store without players who last played before `firstDay`, their copies
 * with them, and without players left with no copies; crawls that finished
 * before `firstDay` drop off the list too. A weapon left with no copies is
 * dropped.
 */
export function pruneCopies(store: CopyStore, firstDay: number): CopyStore {
  const { owners } = store;
  const playing = (owner: number) => owners.played[owner]! >= firstDay;
  // Owners with a copy kept, numbered afresh in their old order.
  const used = new Uint8Array(owners.ids.length);
  for (const weapon of store.weapons.values())
    for (const owner of weapon.owners) if (playing(owner)) used[owner] = 1;
  const renumber = new Uint32Array(owners.ids.length);
  const kept = allocOwners(owners.ids.length);
  let ownerCount = 0;
  used.forEach((isUsed, owner) => {
    if (!isUsed) return;
    renumber[owner] = ownerCount;
    copyOwner(owners, owner, kept, ownerCount++);
  });
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, weapon] of store.weapons) {
    const out = allocWeapon(weapon.columns, weapon.perks, weapon.ids.length);
    let k = 0;
    weapon.owners.forEach((owner, i) => {
      if (playing(owner)) copyRow(weapon, i, out, k++, undefined, renumber);
    });
    if (k > 0) weapons.set(hash, trimmed(out, k));
  }
  return {
    owners: trimmedOwners(kept, ownerCount),
    weapons,
    runs: store.runs.filter((run) => storeDay(Date.parse(run.generatedAt)) >= firstDay),
  };
}

/**
 * The players to read again: those last read on `lastRead` or before, the
 * longest unread first, as the membership type and id a profile read takes.
 */
export function dueOwners(store: CopyStore, lastRead: number) {
  const { owners } = store;
  const due: number[] = [];
  owners.read.forEach((day, i) => {
    if (day <= lastRead) due.push(i);
  });
  return due
    .sort((a, b) => owners.read[a]! - owners.read[b]!)
    .map((i) => ({ type: owners.types[i]!, id: owners.ids[i]! }));
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
 * The snapshot the app reads: the store tallied (see tallyCopies), its players,
 * the span of the crawls it lists, and the crawls.
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
    players: store.owners.ids.length,
    weapons: tallyCopies(store, columnsOf),
    crawls: runs,
  };
}
