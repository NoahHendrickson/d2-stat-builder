/**
 * Perk popularity: which perks players actually run on each legendary weapon.
 *
 * `scripts/crawl-perk-popularity.ts` samples recently active players through
 * Bungie's public API (recent post-game reports give the players; their
 * profiles give the rolls on the weapons they had equipped) and tallies each
 * weapon's perks per column, split by whether the report was PvE or PvP. The
 * snapshot is published off Vercel, on GitHub Pages, and the weapon page reads
 * it from there.
 */

/** Where the published snapshot lives (GitHub Pages, so serving it costs Vercel nothing). */
export const PERK_POPULARITY_URL =
  "https://noahhendrickson.github.io/d2-conflux-data/perk-popularity.json";

/** Counts as [PvE, PvP]. */
export type ModeCounts = [pve: number, pvp: number];
export type PopularityMode = "pve" | "pvp";

export interface WeaponPopularity {
  /** Equipped copies seen. */
  copies: ModeCounts;
  /**
   * Per catalog column (same index as `weapon.columns`): base perk hash → copies
   * running it. Columns with a single perk are left empty.
   */
  columns: Record<string, ModeCounts>[];
}

export interface PerkPopularityIndex {
  schema: 1;
  generatedAt: string;
  /** The span of the post-game reports sampled. */
  from: string;
  to: string;
  /** Distinct players sampled. */
  players: number;
  /** By weapon item hash. */
  weapons: Record<string, WeaponPopularity>;
}

/** The catalog fields the tally needs, as in public/data/weapons.json. */
export interface PopularityCatalog {
  perks: { hash: number; alternateHashes?: number[] }[];
  weapons: {
    hash: number;
    rarity: string;
    columns: { perkIndices: number[] }[];
  }[];
}

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
 * The base perk in each column of one equipped copy, from its sockets' plug
 * hashes in socket order (undefined for an empty socket). Columns follow socket
 * order, so each column takes the first socket after the previous column's that
 * holds one of its perks; that keeps a perk two columns share (Opening Shot in
 * both trait columns) in the right one. A column with no match is undefined.
 */
export function equippedPerks(
  columns: Map<number, number>[],
  plugs: readonly (number | undefined)[],
): (number | undefined)[] {
  let next = 0;
  return columns.map((column) => {
    if (column.size === 0) return undefined;
    for (let socket = next; socket < plugs.length; socket++) {
      const base = plugs[socket] === undefined ? undefined : column.get(plugs[socket]!);
      if (base !== undefined) {
        next = socket + 1;
        return base;
      }
    }
    return undefined;
  });
}

/** Adds one equipped copy to the tally. */
export function addCopy(
  tally: Record<string, WeaponPopularity>,
  weaponHash: number,
  perks: (number | undefined)[],
  mode: PopularityMode,
) {
  const slot = mode === "pve" ? 0 : 1;
  const weapon = (tally[weaponHash] ??= {
    copies: [0, 0],
    columns: perks.map(() => ({})),
  });
  weapon.copies[slot]++;
  perks.forEach((perk, column) => {
    if (perk === undefined) return;
    const counts = (weapon.columns[column]![perk] ??= [0, 0]);
    counts[slot]++;
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
 * A column's perks by popularity in one mode (or both together), most run
 * first. Shares are of the copies whose perk in this column was identified.
 */
export function columnShares(
  weapon: WeaponPopularity,
  column: number,
  mode: PopularityMode | "all",
): PerkShare[] {
  const counts = Object.entries(weapon.columns[column] ?? {}).map(([hash, [pve, pvp]]) => ({
    hash: Number(hash),
    count: mode === "pve" ? pve : mode === "pvp" ? pvp : pve + pvp,
  }));
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  return counts
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, share: c.count / total }))
    .sort((a, b) => b.count - a.count);
}

/** Copies seen in a mode (or both together). */
export function copiesSeen(weapon: WeaponPopularity, mode: PopularityMode | "all") {
  const [pve, pvp] = weapon.copies;
  return mode === "pve" ? pve : mode === "pvp" ? pvp : pve + pvp;
}
