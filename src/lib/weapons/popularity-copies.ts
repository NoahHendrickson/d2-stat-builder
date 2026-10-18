/**
 * The copy store behind perk popularity: every copy of a legendary weapon the
 * crawler has seen, once each, keyed by its item instance id, with the perk in
 * each column and the player it belongs to. A copy seen again replaces its
 * earlier record. A player's copies count for as long as they keep playing:
 * each crawl reads again players it hasn't read for a while (recheckPlan),
 * which refreshes their copies and when they last played, and a player who
 * hasn't played for --days drops out with all their copies (pruneCopies). A
 * read that saw their whole inventory drops what they no longer have; for
 * everyone else a copy unseen for --unseen-days drops out. The snapshot the
 * app reads is the store tallied (snapshotFromCopies).
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

/**
 * The players whose copies are in the store, one array per field: owner n is
 * index n of each. OWNER_ARRAYS is the one list of the fields, in file order.
 */
const OWNER_ARRAYS = {
  /** Bungie membership id. */
  ids: BigUint64Array,
  /** Bungie membership type (platform), which a profile read needs alongside the id. */
  types: Uint8Array,
  /**
   * The latest UTC day (days since 1970-01-01) they're known to have played:
   * from their profile, or from a report they turned up in; 0 when a crawl
   * couldn't tell.
   */
  played: Uint16Array,
  /**
   * The minute (since 1970) we last read their profile, to the minute so two
   * crawls of one day still order; 0 in a crawl that only saw them in a report.
   */
  read: Uint32Array,
  /** 1 when that read saw their vault and inventories, so it listed every copy they have. */
  whole: Uint8Array,
};
export type Owners = { [F in keyof typeof OWNER_ARRAYS]: InstanceType<(typeof OWNER_ARRAYS)[F]> };
export const OWNER_FIELDS = Object.keys(OWNER_ARRAYS) as (keyof Owners)[];

/**
 * One weapon's copies, sorted by id, one array per field: copy n is index n of
 * each, and picks `columns` per copy. COPY_ARRAYS is the one list of the
 * fields, in file order.
 */
const COPY_ARRAYS = {
  ids: BigUint64Array,
  /** The day each copy was last seen. */
  seen: Uint16Array,
  /** Each copy's owner, an index into the store's Owners. */
  owners: Uint32Array,
  /** Per copy, `columns` indices into `perks`; UNKNOWN where the column's perk wasn't identified. */
  picks: Uint8Array,
};
type CopyArrays = { [F in keyof typeof COPY_ARRAYS]: InstanceType<(typeof COPY_ARRAYS)[F]> };
export const COPY_FIELDS = Object.keys(COPY_ARRAYS) as (keyof CopyArrays)[];
export interface WeaponCopies extends CopyArrays {
  /** How many columns each copy has a pick for: the catalog's column count. */
  columns: number;
  /** Base perk hashes the picks index into. */
  perks: number[];
}

export interface CopyStore {
  owners: Owners;
  /** By weapon item hash. */
  weapons: Map<number, WeaponCopies>;
  /**
   * The crawls of the last --days, oldest first; `generatedAt` tells them apart.
   * Provenance for that window, and what keeps a crawl from being merged twice
   * within it, not a full ledger: copies outlive the crawls that found them.
   */
  runs: CrawlSource[];
}

/** A weapon's catalog columns, by hash; undefined for a weapon the catalog doesn't have. */
export type CatalogColumns = (hash: number) => readonly { kind: string }[] | undefined;

/** A pick for a column whose perk wasn't identified. */
export const UNKNOWN = 255;

/** Today, or the day `ms` falls on, as a store day (UTC). */
export const storeDay = (ms = Date.now()) => Math.floor(ms / 86_400_000);

/** The minute `ms` falls in, as Owners.read keeps it. */
export const storeMinute = (ms: number) => Math.floor(ms / 60_000);

/** The day a store minute falls on. */
const dayOfMinute = (minute: number) => Math.floor(minute / 1_440);

export type AnyArray = BigUint64Array | Uint32Array | Uint16Array | Uint8Array;
/** The bytes behind a typed array, as they are in memory. */
export const bytesOf = (array: AnyArray) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

export const allocOwners = (length: number) =>
  Object.fromEntries(OWNER_FIELDS.map((field) => [field, new OWNER_ARRAYS[field](length)])) as Owners;

/** The first `length` owners, in arrays of their own. */
const trimmedOwners = (owners: Owners, length: number) =>
  Object.fromEntries(OWNER_FIELDS.map((field) => [field, owners[field].slice(0, length)])) as Owners;

/** Copies owner `i` of `from` into slot `k` of `to`. */
function copyOwner(from: Owners, i: number, to: Owners, k: number) {
  for (const field of OWNER_FIELDS) to[field][k] = from[field][i]!;
}

export const emptyStore = (): CopyStore => ({ owners: allocOwners(0), weapons: new Map(), runs: [] });

export const copyCount = (store: CopyStore) =>
  [...store.weapons.values()].reduce((sum, weapon) => sum + weapon.ids.length, 0);

/** Room for `length` copies of a weapon with `columns` columns, every pick UNKNOWN. */
export function allocWeapon(columns: number, perks: number[], length: number): WeaponCopies {
  const arrays = Object.fromEntries(
    COPY_FIELDS.map((field) => [field, new COPY_ARRAYS[field](field === "picks" ? length * columns : length)]),
  ) as CopyArrays;
  arrays.picks.fill(UNKNOWN);
  return { columns, perks, ...arrays };
}

/** The first `length` copies of `weapon`, in arrays of their own. */
function trimmed(weapon: WeaponCopies, length: number): WeaponCopies {
  const arrays = Object.fromEntries(
    COPY_FIELDS.map((field) => [field, weapon[field].slice(0, field === "picks" ? length * weapon.columns : length)]),
  ) as CopyArrays;
  return { ...weapon, ...arrays };
}

/** Copies `from`'s copy `i` into `to`'s row `k`, its picks through `perkMap` (`from`'s perk index → `to`'s) when given. */
function copyRow(from: WeaponCopies, i: number, to: WeaponCopies, k: number, perkMap?: readonly number[]) {
  to.ids[k] = from.ids[i]!;
  to.seen[k] = from.seen[i]!;
  to.owners[k] = from.owners[i]!;
  const { columns } = from;
  for (let column = 0; column < columns; column++) {
    const pick = from.picks[i * columns + column]!;
    to.picks[k * columns + column] = pick === UNKNOWN || !perkMap ? pick : perkMap[pick]!;
  }
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

/** A player as the crawler read them, or only saw them in a report. */
export interface SeenOwner {
  id: bigint;
  type: number;
  /** The day they last played; undefined when the read couldn't tell, which keeps what the store knew. */
  played: number | undefined;
  /** Whether the read saw their vault and inventories, with every weapon's sockets, so it listed every copy they have. */
  whole: boolean;
  /**
   * Seen in a report but not read (read too recently to read again): proof
   * they played that day, and nothing else. They stay due by their last read.
   */
  sightedOnly?: boolean;
  /** When they were read (ms), if not when the crawl was: a signed-in player's inventory, saved as they loaded it. */
  readAt?: number;
}

/** One copy as the crawler hands it over: its instance id, its owner (an index into the crawl's owners) and base perk per catalog column. */
export interface SeenCopy {
  id: bigint;
  owner: number;
  perks: readonly (number | undefined)[];
}

/** One crawl as a store: its players, read at `readAt` (ms) unless they say otherwise, and their copies, each seen the day its owner was read. */
export function storeFromCrawl(
  owners: readonly SeenOwner[],
  copies: ReadonlyMap<number, readonly SeenCopy[]>,
  readAt: number,
  run: CrawlSource,
): CopyStore {
  const table = allocOwners(owners.length);
  owners.forEach((owner, k) => {
    table.ids[k] = owner.id;
    table.types[k] = owner.type;
    table.played[k] = owner.played ?? 0;
    table.read[k] = owner.sightedOnly ? 0 : storeMinute(owner.readAt ?? readAt);
    table.whole[k] = owner.whole && !owner.sightedOnly ? 1 : 0;
  });
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, list] of copies) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const indexOf = new Map<number, number>();
    const weapon = allocWeapon(sorted[0]!.perks.length, [], sorted.length);
    sorted.forEach((copy, k) => {
      weapon.ids[k] = copy.id;
      weapon.seen[k] = dayOfMinute(table.read[copy.owner]!);
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
 * Whichever read of a player is later (to the minute) wins, whatever order the
 * two come in; reads in the same minute keep the store's record and drop
 * nothing:
 * - a copy in both keeps the record seen on the later day, or on the same
 *   day the one whose owner's read is the later, with any column it couldn't
 *   identify filled from the other;
 * - when the later read saw the player's whole inventory, a copy of theirs
 *   only the earlier read lists is gone (dismantled), on either side;
 * - when they last played is the latest either side knows, so a sighting in a
 *   report (no read) moves only that, and a read that couldn't tell moves nothing.
 * A `newer` whose crawls are all in `older` already (a crawl file merged
 * twice) changes nothing but the catalog check.
 */
export function mergeCopies(older: CopyStore, newer: CopyStore, columnsOf: CatalogColumns): CopyStore {
  const applied = new Set(older.runs.map((run) => run.generatedAt));
  const fresh = newer.runs.filter((run) => !applied.has(run.generatedAt));
  const adding = fresh.length > 0 ? newer : emptyStore();

  // Owners: older's keep their indices; newer's are updated in place or appended.
  // With no one to add (the merge that only holds the store to the catalog), older's as they are.
  const olderCount = older.owners.ids.length;
  const adds = adding.owners.ids.length > 0;
  const owners = adds ? allocOwners(olderCount + adding.owners.ids.length) : older.owners;
  if (adds) for (const field of OWNER_FIELDS) bytesOf(owners[field]).set(bytesOf(older.owners[field]));
  const index = adds ? ownerIndex(older.owners) : new Map<bigint, number>();
  let ownerCount = olderCount;
  const ownerMap = new Uint32Array(adding.owners.ids.length);
  /** Players whose newer read is the later, whole one: older copies it didn't list are gone. */
  const goneFromOlder = new Set<number>();
  /** Players whose older read is the later, whole one: newer copies it didn't list are gone. */
  const goneFromNewer = new Set<number>();
  /** Players whose newer read is the later one (or who are new): a copy both list, seen the same day, is newer's. */
  const newerLater = new Set<number>();
  for (let i = 0; i < adding.owners.ids.length; i++) {
    const known = index.get(adding.owners.ids[i]!);
    const k = known ?? ownerCount++;
    ownerMap[i] = k;
    if (known === undefined) {
      copyOwner(adding.owners, i, owners, k);
      newerLater.add(k);
      continue;
    }
    owners.played[k] = Math.max(owners.played[k]!, adding.owners.played[i]!);
    const read = adding.owners.read[i]!;
    // Only seen in a report: when they played is all it says.
    if (read === 0) continue;
    if (read > owners.read[k]!) {
      owners.types[k] = adding.owners.types[i]!;
      owners.read[k] = read;
      owners.whole[k] = adding.owners.whole[i]!;
      newerLater.add(k);
      if (adding.owners.whole[i]) goneFromOlder.add(k);
    } else if (read < owners.read[k]! && owners.whole[k]) goneFromNewer.add(k);
  }

  const weapons = new Map<number, WeaponCopies>();
  for (const hash of new Set([...older.weapons.keys(), ...adding.weapons.keys()])) {
    const columns = columnsOf(hash)?.length;
    if (columns === undefined) continue;
    const none = allocWeapon(columns, [], 0);
    const fits = (weapon: WeaponCopies | undefined) => (weapon?.columns === columns ? weapon : none);
    const b = fits(adding.weapons.get(hash));
    // Newer's copies in the merged owner numbering, so the join sees one numbering.
    const rebased = { ...b, owners: b.owners.map((owner) => ownerMap[owner]!) };
    const merged = mergeWeapon(fits(older.weapons.get(hash)), rebased, goneFromOlder, goneFromNewer, newerLater);
    if (merged.ids.length > 0) weapons.set(hash, merged);
  }
  return { owners: adds ? trimmedOwners(owners, ownerCount) : owners, weapons, runs: [...older.runs, ...fresh] };
}

/**
 * A merge join of `a` and `b`'s sorted ids into room for both, trimmed after.
 * A copy on one side only is kept unless its owner is in that side's gone set;
 * a copy on both is the later sighting, `b`'s on the same day when its owner
 * is in `bLater`.
 * A side with nothing to add or drop comes back as it is: most weapons, most
 * merges, since a crawl touches a fraction of the store.
 */
function mergeWeapon(
  a: WeaponCopies,
  b: WeaponCopies,
  goneFromA: ReadonlySet<number>,
  goneFromB: ReadonlySet<number>,
  bLater: ReadonlySet<number>,
): WeaponCopies {
  const untouched = (side: WeaponCopies, gone: ReadonlySet<number>) =>
    gone.size === 0 || !side.owners.some((owner) => gone.has(owner));
  if (b.ids.length === 0 && untouched(a, goneFromA)) return a;
  if (a.ids.length === 0 && untouched(b, goneFromB)) return b;
  const { columns } = a;
  const perks: number[] = [];
  const indexOf = new Map<number, number>();
  const remapA = a.perks.map((perk) => pickFor(perk, perks, indexOf));
  const remapB = b.perks.map((perk) => pickFor(perk, perks, indexOf));
  const out = allocWeapon(columns, perks, a.ids.length + b.ids.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.ids.length || j < b.ids.length) {
    if (j >= b.ids.length || (i < a.ids.length && a.ids[i]! < b.ids[j]!)) {
      if (!goneFromA.has(a.owners[i]!)) copyRow(a, i, out, k++, remapA);
      i++;
    } else if (i >= a.ids.length || b.ids[j]! < a.ids[i]!) {
      if (!goneFromB.has(b.owners[j]!)) copyRow(b, j, out, k++, remapB);
      j++;
    } else {
      // The same copy: the later sighting, its gaps filled from the other.
      const bIsLater = a.seen[i]! === b.seen[j]! ? bLater.has(b.owners[j]!) : b.seen[j]! > a.seen[i]!;
      const [later, at, remap, other, otherAt, otherRemap] = bIsLater
        ? [b, j, remapB, a, i, remapA]
        : [a, i, remapA, b, j, remapB];
      copyRow(later, at, out, k, remap);
      for (let column = 0; column < columns; column++) {
        const pick = other.picks[otherAt * columns + column]!;
        if (out.picks[k * columns + column] === UNKNOWN && pick !== UNKNOWN)
          out.picks[k * columns + column] = otherRemap[pick]!;
      }
      i++;
      j++;
      k++;
    }
  }
  return trimmed(out, k);
}

/**
 * The store without players who last played before `firstDay`, their copies
 * with them; without the copies of a player whose latest read didn't see
 * everything (a private vault) that haven't been seen since `firstSeen`, since
 * nothing else can tell those were dismantled (a whole read drops what's gone
 * itself); and without players left with no copies. Crawls that finished
 * before `firstDay` drop off the list too. A weapon left with no copies is
 * dropped. When nothing goes, the copies are kept as they are.
 */
export function pruneCopies(store: CopyStore, firstDay: number, firstSeen = 0): CopyStore {
  const { owners } = store;
  const runs = store.runs.filter((run) => storeDay(Date.parse(run.generatedAt)) >= firstDay);
  const keeps = (weapon: WeaponCopies, i: number) => {
    const owner = weapon.owners[i]!;
    return owners.played[owner]! >= firstDay && (owners.whole[owner] === 1 || weapon.seen[i]! >= firstSeen);
  };
  // Players kept: still playing, with a copy kept.
  const kept = new Uint8Array(owners.ids.length);
  let copiesGo = false;
  for (const weapon of store.weapons.values())
    for (let i = 0; i < weapon.ids.length; i++) {
      if (keeps(weapon, i)) kept[weapon.owners[i]!] = 1;
      else copiesGo = true;
    }
  if (!copiesGo && kept.every(Boolean)) return { ...store, runs };

  // Number the players kept afresh, in their old order.
  const renumber = new Uint32Array(owners.ids.length);
  const keptOwners = allocOwners(owners.ids.length);
  let ownerCount = 0;
  kept.forEach((keep, owner) => {
    if (!keep) return;
    renumber[owner] = ownerCount;
    copyOwner(owners, owner, keptOwners, ownerCount++);
  });
  const weapons = new Map<number, WeaponCopies>();
  for (const [hash, weapon] of store.weapons) {
    const out = allocWeapon(weapon.columns, weapon.perks, weapon.ids.length);
    let k = 0;
    for (let i = 0; i < weapon.ids.length; i++) if (keeps(weapon, i)) copyRow(weapon, i, out, k++);
    if (k === 0) continue;
    const left = k === weapon.ids.length ? weapon : trimmed(out, k);
    weapons.set(hash, { ...left, owners: left.owners.map((owner) => renumber[owner]!) });
  }
  return { owners: trimmedOwners(keptOwners, ownerCount), weapons, runs };
}

/** A player to read again: the membership type and id a profile read takes. */
export interface DuePlayer {
  type: number;
  id: string;
}

/**
 * Which players a crawl reads again, from the store's owners: those not read
 * for `afterDays`, the longest unread first, with at most half the crawl's
 * reads, and which players it found it should pass over as read too recently.
 */
export function recheckPlan(owners: Owners, today: number, afterDays: number) {
  /** Each player's last read, as a day. */
  const lastRead = new Map<string, number>();
  const due: number[] = [];
  owners.ids.forEach((id, i) => {
    const day = dayOfMinute(owners.read[i]!);
    lastRead.set(id.toString(), day);
    if (day <= today - afterDays) due.push(i);
  });
  const queue: DuePlayer[] = due
    .sort((a, b) => owners.read[a]! - owners.read[b]!)
    .map((i) => ({ type: owners.types[i]!, id: owners.ids[i]!.toString() }));
  let next = 0;
  return {
    players: lastRead.size,
    /** In the store, so a read of them is a read again. */
    known: (id: string) => lastRead.has(id),
    /** In the store and read within `afterDays`: not worth a read now. */
    recentlyRead: (id: string) => (lastRead.get(id) ?? -Infinity) > today - afterDays,
    /**
     * The next player to read again, if reading them keeps re-reads at half or
     * less of the reads `started` so far (every read, re-reads included,
     * counted when it starts, whether or not it succeeds).
     */
    next(started: number, rereads: number): DuePlayer | undefined {
      if (next >= queue.length || (rereads + 1) * 2 > started + 1) return undefined;
      return queue[next++];
    },
    remaining: () => queue.length - next,
  };
}

/**
 * A short fingerprint of the weapons a crawl could list and their column
 * counts (its catalog's random-rolled legendaries, by hash → columns), so the
 * merge can tell when a crawl ran on a different catalog and can't vouch that
 * a copy it didn't list is gone.
 */
export function lookupFingerprint(lookup: ReadonlyMap<number, readonly unknown[]>) {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const weapon of [...lookup.keys()].sort((a, b) => a - b)) {
    mix(weapon);
    mix(lookup.get(weapon)!.length);
  }
  return hash.toString(16).padStart(8, "0");
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
