/**
 * Perk popularity: which perks players actually run in PvE on each legendary
 * weapon.
 *
 * `scripts/crawl-perk-popularity.ts` samples recently active players through
 * Bungie's public API (recent PvE post-game reports give the players; their
 * profiles give the rolls on the weapons they used) and tallies each weapon's
 * perks per column, and the left + right trait pair as a combo. PvP matches are
 * skipped. Each crawl samples matches as they end; a merge adds up the last
 * week's crawls (mergePopularity) into the snapshot published off Vercel, on
 * GitHub Pages, which the weapon page reads.
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
  /**
   * Left + right trait combos ("leftHash,rightHash", base perk hashes) → copies
   * running both. Only weapons with exactly two trait columns; missing in crawls
   * from before combos were counted.
   */
  combos?: Record<string, number>;
}

/** The tally every snapshot carries, and all the app reads. */
export interface PerkPopularityIndex {
  /** 2: PvE only, plain counts (1 held [PvE, PvP] pairs). */
  schema: 2;
  generatedAt: string;
  /** The span of the post-game reports sampled, by when they ended. */
  from: string;
  to: string;
  /**
   * Characters read: distinct players within one crawl, but added up across
   * crawls by the merge, so a player seen in several crawls (common, with
   * several a day) counts once per crawl. Player-crawls, not players.
   */
  players: number;
  /** By weapon item hash. */
  weapons: Record<string, WeaponPopularity>;
}

/** One crawl's output, a file in the data repo's daily/. */
export interface CrawlFile extends PerkPopularityIndex {
  /** How it drew its reports; missing only in crawls from before it was recorded. */
  sample?: CrawlSample;
}

/** The published snapshot: the merge of the crawl files. */
export interface MergedPopularity extends PerkPopularityIndex {
  /** Its inputs, one per crawl file in file order: where every count came from. */
  crawls: CrawlSource[];
}

/**
 * Matches that just ended (`recent`, read minutes later), or a fixed window
 * (`window`; an `until` well before the crawl's generatedAt is a backfill, read
 * days after the matches).
 */
export type CrawlSample = { kind: "recent"; minutes: number } | { kind: "window"; hours: number; until: string };

/** One crawl file, as the merged snapshot lists it. */
export interface CrawlSource {
  file: string;
  generatedAt: string;
  from: string;
  to: string;
  players: number;
  copies: number;
  sample?: CrawlSample;
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

/**
 * Adds one copy to the tally: its perk in each column, and, given the weapon's
 * `traits` columns, its left + right combo when both were identified.
 */
export function addCopy(
  tally: Record<string, WeaponPopularity>,
  weaponHash: number,
  perks: (number | undefined)[],
  traits?: [left: number, right: number],
) {
  const weapon = (tally[weaponHash] ??= { copies: 0, columns: perks.map(() => ({})) });
  weapon.copies++;
  perks.forEach((perk, column) => {
    if (perk === undefined) return;
    const counts = weapon.columns[column]!;
    counts[perk] = (counts[perk] ?? 0) + 1;
  });
  const left = traits && perks[traits[0]];
  const right = traits && perks[traits[1]];
  if (left !== undefined && right !== undefined) {
    const combos = (weapon.combos ??= {});
    const key = comboKey(left, right);
    combos[key] = (combos[key] ?? 0) + 1;
  }
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

/** Every weapon's copies in a snapshot, added up. */
export function totalCopies(index: PerkPopularityIndex) {
  return Object.values(index.weapons).reduce((sum, w) => sum + w.copies, 0);
}

/**
 * Crawls added up into one snapshot: copies, perk and combo counts summed per
 * weapon, players summed, the span from the earliest crawl to the latest. A
 * column a weapon gained between crawls just starts later. Each file is listed
 * in `crawls`, so a count can be traced to how and when it was crawled.
 */
export function mergePopularity(
  files: readonly { file: string; crawl: CrawlFile }[],
  generatedAt = new Date().toISOString(),
): MergedPopularity {
  const crawls = files.map((f) => f.crawl);
  const weapons: Record<string, WeaponPopularity> = {};
  for (const crawl of crawls) {
    for (const [hash, counts] of Object.entries(crawl.weapons)) {
      const weapon = (weapons[hash] ??= { copies: 0, columns: [] });
      weapon.copies += counts.copies;
      counts.columns.forEach((column, i) => {
        const into = (weapon.columns[i] ??= {});
        for (const [perk, n] of Object.entries(column)) into[perk] = (into[perk] ?? 0) + n;
      });
      for (const [key, n] of Object.entries(counts.combos ?? {})) {
        const combos = (weapon.combos ??= {});
        combos[key] = (combos[key] ?? 0) + n;
      }
    }
  }
  // Fill holes, so every weapon's columns line up with its catalog columns.
  for (const weapon of Object.values(weapons))
    weapon.columns = Array.from(weapon.columns, (column) => column ?? {});
  const spans = crawls.map((c) => [c.from, c.to]).filter(([from, to]) => from && to);
  return {
    schema: 2,
    generatedAt,
    from: spans.map(([from]) => from!).sort()[0] ?? "",
    to: spans.map(([, to]) => to!).sort().at(-1) ?? "",
    players: crawls.reduce((sum, c) => sum + c.players, 0),
    weapons,
    crawls: files.map(({ file, crawl }) => ({
      file,
      generatedAt: crawl.generatedAt,
      from: crawl.from,
      to: crawl.to,
      players: crawl.players,
      copies: totalCopies(crawl),
      ...(crawl.sample && { sample: crawl.sample }),
    })),
  };
}
