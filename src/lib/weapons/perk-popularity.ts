/**
 * Perk popularity: which perks players have on each legendary weapon.
 *
 * `scripts/crawl-perk-popularity.ts` finds active players through Bungie's
 * public API (recent PvE post-game reports give the players) and reads the
 * perks on every copy of a legendary they have equipped, or in a vault they've
 * made public; players signed in to the site add their whole inventory
 * (popularity-contribution.ts). Each copy counts once, kept in a copy store
 * for as long as its owner keeps playing (popularity-copies.ts); the merge
 * tallies the store
 * into the snapshot published off Vercel, on GitHub Pages, which the weapon
 * page reads: each weapon's perks per column, and the left + right trait pair
 * as a combo.
 */

import type { Hazard } from "./popularity-hazard";
import type { CompactWeaponIndex } from "./transport";

/** Where the published snapshot lives (GitHub Pages, so serving it costs Vercel nothing). */
export const PERK_POPULARITY_URL =
  "https://noahhendrickson.github.io/d2-conflux-data/perk-popularity.json";

export interface WeaponPopularity {
  /** Distinct copies, equipped or in a public vault, of players who've played in the last two weeks. */
  copies: number;
  /**
   * Per catalog column (same index as `weapon.columns`): base perk hash → copies
   * running it. Columns with a single perk are left empty.
   */
  columns: Record<string, number>[];
  /**
   * Left + right trait combos ("leftHash,rightHash", base perk hashes) → copies
   * running both. Only weapons with exactly two trait columns; missing in crawls
   * from before combos were counted.
   */
  combos?: Record<string, number>;
}

/** The tally every snapshot carries, and all the app reads. */
export interface PerkPopularityIndex {
  /**
   * 2: plain counts (1 held [PvE, PvP] pairs). Since the copy store, counts
   * are distinct copies rather than sightings, in the same shape.
   */
  schema: 2;
  generatedAt: string;
  /** The span of the post-game reports the players were found through, by when they ended. */
  from: string;
  to: string;
  /** The players whose copies are counted (in snapshots before the copy store, profile reads added up across crawls). */
  players: number;
  /** By weapon item hash. */
  weapons: Record<string, WeaponPopularity>;
}

/** The published snapshot: the copy store tallied. */
export interface MergedPopularity extends PerkPopularityIndex {
  /** The crawls of the last two weeks, oldest first. A player's copies can be older: they last as long as the player plays. */
  crawls: CrawlSource[];
  /** How often a copy out of the loadout turns out to be gone, by days since last equipped (popularity-hazard.ts); missing in snapshots from before it was kept. */
  hazard?: Hazard;
}

/**
 * Players found through matches that just ended (`recent`), or through a fixed
 * window of matches (`window`) up to `until`; or the weapons players signed in
 * to the site saved as they loaded their inventory (`signed-in`), when `from`
 * and `to` span when those were saved.
 */
export type CrawlSample =
  | { kind: "recent"; minutes: number }
  | { kind: "window"; hours: number; until: string }
  | { kind: "signed-in" };

/** One crawl, as the copy store and the snapshot list it. */
export interface CrawlSource {
  /** When it finished, which is also what tells two crawls apart. */
  generatedAt: string;
  from: string;
  to: string;
  /** Profiles it read, `rechecked` of them players already in the store. */
  players: number;
  rechecked: number;
  /** Copies it read, before any were found to be already in the store. */
  copies: number;
  /**
   * Players among them read whole: vault and character inventories public, and
   * every weapon's sockets with them, so the read listed every copy they have.
   * Before owners were kept (vault or inventories public, and only players
   * with a tracked weapon) the count isn't comparable.
   */
  vaults: number;
  sample: CrawlSample;
  /** lookupFingerprint of the weapons the crawl could list; the merge trusts its whole reads only on the same catalog. */
  catalog: string;
  /**
   * Players in the store due to be read again (recheckPlan) that the crawl
   * didn't read, however it found them, by the time it ended: for its cap on
   * re-reads, its time, or an early end. Growing over crawls of one length,
   * re-reads aren't keeping up, and players go unread for longer than the
   * unseen window allows for. Not kept by signed-in crawls, or by crawls from
   * before it was.
   */
  due?: number;
}

/** The catalog fields the tally needs: public/data/weapons.json, narrowed. */
export type PopularityCatalog = {
  perks: Pick<CompactWeaponIndex["perks"][number], "hash" | "alternateHashes">[];
  weapons: (Pick<CatalogWeapon, "hash" | "rarity"> & {
    columns: Pick<CatalogWeapon["columns"][number], "perkIndices" | "kind">[];
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

/**
 * A weapon's left and right trait columns, by index: its two "Trait" columns,
 * or undefined when it doesn't have exactly two (no combos for it).
 */
export function traitColumns(
  columns: readonly { kind: string }[],
): [left: number, right: number] | undefined {
  const traits = columns.flatMap((column, i) => (column.kind === "Trait" ? [i] : []));
  return traits.length === 2 ? [traits[0]!, traits[1]!] : undefined;
}

/** A combo's key in `WeaponPopularity.combos`. */
export const comboKey = (left: number, right: number) => `${left},${right}`;

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

/** One left + right combo's share, for display. */
export interface ComboShare {
  left: number;
  right: number;
  count: number;
  /** Its share of the copies whose left and right perks were both identified, 0–1. */
  share: number;
}

/** A weapon's combos by popularity, most run first. */
export function comboShares(weapon: WeaponPopularity): ComboShare[] {
  const entries = Object.entries(weapon.combos ?? {});
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return entries
    .map(([key, count]) => {
      const [left, right] = key.split(",").map(Number);
      return { left: left!, right: right!, count, share: count / total };
    })
    .sort((a, b) => b.count - a.count);
}
