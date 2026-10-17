/**
 * Perk popularity: which perks players actually run in PvE on each legendary
 * weapon.
 *
 * `scripts/crawl-perk-popularity.ts` samples recently active players through
 * Bungie's public API (recent PvE post-game reports give the players; their
 * profiles give the rolls on the weapons they used) and tallies each weapon's
 * perks per column. PvP matches are skipped. The snapshot is published off
 * Vercel, on GitHub Pages, and the weapon page reads it from there.
 */

import type { CompactWeaponIndex } from "./transport";

/** Where the published snapshot lives (GitHub Pages, so serving it costs Vercel nothing). */
export const PERK_POPULARITY_URL =
  "https://noahhendrickson.github.io/d2-conflux-data/perk-popularity.json";

export interface WeaponPopularity {
  /** Copies seen used in PvE. */
  copies: number;
  /**
   * Per catalog column (same index as `weapon.columns`): base perk hash → copies
   * running it. Columns with a single perk are left empty.
   */
  columns: Record<string, number>[];
}

export interface PerkPopularityIndex {
  /** 2: PvE only, plain counts (1 held [PvE, PvP] pairs). */
  schema: 2;
  generatedAt: string;
  /** The span of the post-game reports sampled. */
  from: string;
  to: string;
  /** Distinct players sampled. */
  players: number;
  /** By weapon item hash. */
  weapons: Record<string, WeaponPopularity>;
}

/** The catalog fields the tally needs: public/data/weapons.json, narrowed. */
export type PopularityCatalog = {
  perks: Pick<CompactWeaponIndex["perks"][number], "hash" | "alternateHashes">[];
  weapons: (Pick<CatalogWeapon, "hash" | "rarity"> & {
    columns: Pick<CatalogWeapon["columns"][number], "perkIndices">[];
  })[];
};
type CatalogWeapon = CompactWeaponIndex["weapons"][number];

/**
 * What the tally keeps of the catalog: for each random-rolled legendary, every
 * column's perks by any of their plug hashes (enhanced tiers included) mapped
 * to the base perk's hash.
 */
export type PopularityLookup = Map<number, Map<number, number>[]>;

export function popularityLookup(catalog: PopularityCatalog): PopularityLookup {
  const lookup: PopularityLookup = new Map();
  for (const weapon of catalog.weapons) {
    if (weapon.rarity !== "Legendary") continue;
    const columns = weapon.columns.map((column) => {
      const plugs = new Map<number, number>();
      if (column.perkIndices.length < 2) return plugs;
      for (const index of column.perkIndices) {
        const perk = catalog.perks[index];
        if (!perk) continue;
        plugs.set(perk.hash, perk.hash);
        for (const alternate of perk.alternateHashes ?? []) plugs.set(alternate, perk.hash);
      }
      return plugs;
    });
    if (columns.some((plugs) => plugs.size > 0)) lookup.set(weapon.hash, columns);
  }
  return lookup;
}

/**
 * Which socket each column lives in on this weapon, learned from copies of it
 * (each copy's plug hashes by socket index; undefined for an empty socket).
 * Every copy of a weapon shares one socket layout, and most perks belong to one
 * column only, so a column is placed at the socket where its own perks turn up
 * most. Perks two columns share (Opening Shot in both trait columns) can't say
 * which column they're in, so they don't vote. A column no copy places is
 * undefined, and two columns never share a socket.
 */
export function columnSockets(
  columns: Map<number, number>[],
  copies: readonly (readonly (number | undefined)[])[],
): (number | undefined)[] {
  const owners = new Map<number, number>();
  columns.forEach((column, i) => {
    for (const plug of column.keys()) owners.set(plug, owners.has(plug) ? -1 : i);
  });
  // votes[column][socket] = copies with one of only this column's perks there.
  const votes = columns.map(() => new Map<number, number>());
  for (const plugs of copies) {
    plugs.forEach((plug, socket) => {
      const owner = plug === undefined ? undefined : owners.get(plug);
      if (owner === undefined || owner < 0) return;
      votes[owner]!.set(socket, (votes[owner]!.get(socket) ?? 0) + 1);
    });
  }
  const taken = new Set<number>();
  return votes.map((byIndex) => {
    let best: number | undefined;
    for (const [socket, count] of byIndex)
      if (!taken.has(socket) && (best === undefined || count > byIndex.get(best)!)) best = socket;
    if (best !== undefined) taken.add(best);
    return best;
  });
}

/**
 * The base perk in each column of one copy, read from the column's own socket
 * (see `columnSockets`). A column whose socket holds something the catalog
 * doesn't list for it is undefined, rather than borrowing a neighbour's perk.
 */
export function perksAtSockets(
  columns: Map<number, number>[],
  sockets: readonly (number | undefined)[],
  plugs: readonly (number | undefined)[],
): (number | undefined)[] {
  return columns.map((column, i) => {
    const socket = sockets[i];
    const plug = socket === undefined ? undefined : plugs[socket];
    return plug === undefined ? undefined : column.get(plug);
  });
}

/** Adds one copy to the tally. */
export function addCopy(
  tally: Record<string, WeaponPopularity>,
  weaponHash: number,
  perks: (number | undefined)[],
) {
  const weapon = (tally[weaponHash] ??= { copies: 0, columns: perks.map(() => ({})) });
  weapon.copies++;
  perks.forEach((perk, column) => {
    if (perk === undefined) return;
    const counts = weapon.columns[column]!;
    counts[perk] = (counts[perk] ?? 0) + 1;
  });
}

/** One perk's share of a column, for display. */
export interface PerkShare {
  hash: number;
  /** Copies running it. */
  count: number;
  /** Its share of the copies seen in this column, 0–1. */
  share: number;
}

/**
 * A column's perks by popularity, most run first. Shares are of the copies
 * whose perk in this column was identified.
 */
export function columnShares(weapon: WeaponPopularity, column: number): PerkShare[] {
  const counts = Object.entries(weapon.columns[column] ?? {}).map(([hash, count]) => ({
    hash: Number(hash),
    count,
  }));
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  return counts
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, share: c.count / total }))
    .sort((a, b) => b.count - a.count);
}
