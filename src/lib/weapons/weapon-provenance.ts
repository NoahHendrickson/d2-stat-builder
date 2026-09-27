import type { DestinyCollectibleDefinition } from "bungie-api-ts/destiny2";
import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { ManifestDefs } from "./manifest";

/** Canonical raid names shown in the Source filter. */
export const RAID_SOURCE_LABELS = [
  "Last Wish",
  "Scourge of the Past",
  "Crown of Sorrow",
  "Garden of Salvation",
  "Deep Stone Crypt",
  "Vault of Glass",
  "Vow of the Disciple",
  "King's Fall",
  "Root of Nightmares",
  "Crota's End",
  "Salvation's Edge",
  "The Desert Perpetual",
  "Pantheon",
] as const;

/** Canonical dungeon names shown in the Source filter. */
export const DUNGEON_SOURCE_LABELS = [
  "The Shattered Throne",
  "Pit of Heresy",
  "Prophecy",
  "Grasp of Avarice",
  "Duality",
  "Spire of the Watcher",
  "Ghosts of the Deep",
  "Warlord's Ruin",
  "Vesper's Host",
  "Sundered Doctrine",
] as const;

/** Portal/Ops hub labels shown in the Source filter. */
export const OPS_SOURCE_LABELS = [
  "Fireteam Ops",
  "Solo Ops",
  "Arena Ops",
  "Pinnacle Ops",
  "Raids and Dungeons",
  "Rite of the Nine",
  "Encore",
  "Equilibrium",
] as const;

/** Event and playlist activity labels shown in the Source filter. */
export const EVENT_SOURCE_LABELS = ["Sparrow Racing League"] as const;

/** Curated activity names shown in the Source filter (vendors/generic events excluded). */
export const CURATED_SOURCE_LABELS = [
  ...RAID_SOURCE_LABELS,
  ...DUNGEON_SOURCE_LABELS,
  ...OPS_SOURCE_LABELS,
  ...EVENT_SOURCE_LABELS,
] as const;

/** Shorthand tokens players type when filtering by raid source. */
export const RAID_SOURCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Last Wish": ["lw"],
  "Garden of Salvation": ["gos", "garden"],
  "Deep Stone Crypt": ["dsc", "stone"],
  "Vault of Glass": ["vog", "vault"],
  "Vow of the Disciple": ["vow", "disciple"],
  "King's Fall": ["kf", "kings fall"],
  "Root of Nightmares": ["ron", "root", "nightmares"],
  "Crota's End": ["crota"],
  "Salvation's Edge": ["salvation", "edge"],
  "The Desert Perpetual": ["desert", "perpetual", "tdp"],
  Pantheon: ["panth"],
};

export const DUNGEON_SOURCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "The Shattered Throne": ["shattered", "throne"],
  "Pit of Heresy": ["pit", "heresy"],
  "Grasp of Avarice": ["grasp", "goa"],
  "Spire of the Watcher": ["spire", "watcher"],
  "Ghosts of the Deep": ["ghosts", "gotd"],
  "Warlord's Ruin": ["warlord", "wr"],
  "Vesper's Host": ["vesper", "vh"],
  "Sundered Doctrine": ["sundered", "doctrine"],
};

export const OPS_SOURCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Fireteam Ops": ["fireteam", "vanguard ops"],
  "Solo Ops": ["solo"],
  "Arena Ops": ["arena"],
  "Pinnacle Ops": ["pinnacle", "exotic missions"],
  "Raids and Dungeons": ["raid dungeon", "raids dungeons"],
  "Rite of the Nine": ["rite", "nine"],
};

export const EVENT_SOURCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Sparrow Racing League": ["srl", "sparrow racing", "racing league"],
};

export const ACTIVITY_SOURCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ...RAID_SOURCE_ALIASES,
  ...DUNGEON_SOURCE_ALIASES,
  ...OPS_SOURCE_ALIASES,
  ...EVENT_SOURCE_ALIASES,
};

const SHATTERED_THRONE_SOURCE = "The Shattered Throne";
const DREAMING_CITY_SOURCE_PATTERN = /dreaming city/i;
const SHATTERED_THRONE_DREAMING_CITY_WEAPON_NAMES = new Set(
  [
    "Abide the Return",
    "Retold Tale",
    "Sleepless",
    "Tigerspite",
    "Twilight Oath",
    "Vouchsafe",
    "Waking Vigil",
  ].map((name) => name.toLowerCase()),
);
const PIT_OF_HERESY_SOURCE = "Pit of Heresy";
/**
 * Dungeon loot refreshes ship as new hashes with no collectible, reusing names from older
 * seasonal weapons — so the manifest never names the dungeon. Keyed by lowercased name.
 */
const UPDATED_DUNGEON_WEAPON_SOURCES: ReadonlyMap<string, string> = new Map([
  ...["Canis Major", "Chrysura Melo", "Fractethyst", "Vulpecula"].map(
    (name) => [name.toLowerCase(), SHATTERED_THRONE_SOURCE] as const,
  ),
  // Monument of Triumph (9.7.0) gave Pit of Heresy its own pool of Episode: Heresy reissues.
  ...["Adamantite", "Eyes Unveiled", "Psychopomp", "Refusal of the Call"].map(
    (name) => [name.toLowerCase(), PIT_OF_HERESY_SOURCE] as const,
  ),
]);
/** Collectible placeholder on reissued random-roll items; not an actual source. */
const PLACEHOLDER_SOURCE_PATTERN = /^Random Perks:/i;

const RAID_SOURCE_LABEL_SET = new Set(RAID_SOURCE_LABELS.map((label) => label.toLowerCase()));
const DUNGEON_SOURCE_LABEL_SET = new Set(
  DUNGEON_SOURCE_LABELS.map((label) => label.toLowerCase()),
);
const CURATED_SOURCE_LABEL_SET = new Set(
  CURATED_SOURCE_LABELS.map((label) => label.toLowerCase()),
);

function withoutLeadingArticle(value: string): string {
  return value.replace(/^the\s+/i, "");
}

function exactSourceLabel(labels: readonly string[], value: string): string | undefined {
  const lowerValue = value.toLowerCase();
  const lowerNoArticle = withoutLeadingArticle(value).toLowerCase();
  return labels.find((label) => {
    const lowerLabel = label.toLowerCase();
    return (
      lowerLabel === lowerValue ||
      withoutLeadingArticle(label).toLowerCase() === lowerNoArticle
    );
  });
}

function cleanActivitySourceLabel(source: string | undefined): string | undefined {
  const value = trimActivityLabel(
    source
      ?.replace(/\s+/g, " ")
      .replace(/^Source:\s*/i, "")
      .replace(/^(Raid|Dungeon):\s*/i, "")
      .replace(/"([^"]+)"/g, "$1")
      .replace(/\s*,\s*Eater of Worlds.*$/i, "")
      .replace(/\s*,\s*Spire of Stars.*$/i, "")
      .replace(/\s+(raid(\s+lair)?|dungeon)\.?$/i, "")
      .trim() ?? "",
  );
  return value || undefined;
}

function canonicalSourceFromLabels(
  source: string | undefined,
  labels: readonly string[],
): string | undefined {
  const value = cleanActivitySourceLabel(source);
  if (!value) return undefined;

  const exact = exactSourceLabel(labels, value);
  if (exact) return exact;

  const valueLower = value.toLowerCase();
  const valueNoArticle = withoutLeadingArticle(value).toLowerCase();
  let best: string | undefined;
  for (const label of labels) {
    const labelLower = label.toLowerCase();
    const labelNoArticle = withoutLeadingArticle(label).toLowerCase();
    if (!valueLower.includes(labelLower) && !valueNoArticle.includes(labelNoArticle)) continue;
    if (!best || label.length > best.length) best = label;
  }
  return best;
}

// Canonicalization runs regex cleanup + a label scan; it's called per weapon in
// filter hot loops, so memoize by the raw manifest string (distinct sources are
// bounded — low hundreds across the catalog).
const raidCanonicalCache = new Map<string, string | undefined>();
const activityCanonicalCache = new Map<string, string | undefined>();

/** Map Bungie source strings onto canonical raid labels when possible. */
export function canonicalRaidSource(source: string | undefined): string | undefined {
  if (source == null) return undefined;
  if (raidCanonicalCache.has(source)) return raidCanonicalCache.get(source);

  const value = cleanActivitySourceLabel(source);
  const canonical = value
    ? (canonicalSourceFromLabels(value, RAID_SOURCE_LABELS) ?? value)
    : undefined;
  raidCanonicalCache.set(source, canonical);
  return canonical;
}

/** Map Bungie source strings onto curated activity labels when possible. */
export function canonicalActivitySource(source: string | undefined): string | undefined {
  if (source == null) return undefined;
  if (activityCanonicalCache.has(source)) return activityCanonicalCache.get(source);

  const value = cleanActivitySourceLabel(source);
  const canonical = value
    ? (canonicalSourceFromLabels(value, CURATED_SOURCE_LABELS) ?? value)
    : undefined;
  activityCanonicalCache.set(source, canonical);
  return canonical;
}

/** Destiny season number when an activity first introduced its loot pool (D2 reprisal seasons). */
export const ACTIVITY_INTRO_SEASON: Readonly<Record<string, number>> = {
  "Last Wish": 4,
  "Scourge of the Past": 5,
  "Crown of Sorrow": 7,
  "Garden of Salvation": 8,
  "Deep Stone Crypt": 12,
  "Vault of Glass": 14,
  "Grasp of Avarice": 15,
  "Vow of the Disciple": 16,
  "King's Fall": 18,
  "Spire of the Watcher": 19,
  "Root of Nightmares": 20,
  "Ghosts of the Deep": 21,
  "Crota's End": 22,
  "Warlord's Ruin": 23,
  "Salvation's Edge": 24,
  "Prophecy": 11,
  "Duality": 17,
  "Pit of Heresy": 9,
  "Rite of the Nine": 26,
  "Vesper's Host": 25,
  "Desert Perpetual": 27,
  "The Desert Perpetual": 27,
  "Sundered Doctrine": 26,
  "Equilibrium": 28,
  Encore: 28,
  "Sparrow Racing League": 28,
};

export interface ResolvedWeaponSeason {
  seasonNumber: number;
  seasonName?: string;
}

function trimActivityLabel(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.]+$/g, "").trim();
}

function cleanSourceString(source: string | undefined): string | undefined {
  const value = canonicalRaidSource(source);
  return value ? trimActivityLabel(value) : undefined;
}

export interface ResolvedWeaponSources {
  source?: string;
  sources?: string[];
}

function uniqueSourceLabels(source: string | undefined, sources: readonly string[] = []): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const label of [source, ...sources]) {
    const trimmed = trimActivityLabel(label ?? "");
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    labels.push(trimmed);
    seen.add(key);
  }
  return labels;
}

export function sourceLabels(item: { source?: string; sources?: readonly string[] }): string[] {
  return uniqueSourceLabels(item.source, item.sources);
}

export function sourceFields(
  source: string | undefined,
  sources: readonly string[] = [],
): ResolvedWeaponSources {
  const labels = uniqueSourceLabels(source, sources);
  return {
    source,
    ...(labels.length > 1 ? { sources: labels } : {}),
  };
}

function isDreamingCityShatteredThroneLoot(itemName: string): boolean {
  const name = itemName.trim();
  return (
    SHATTERED_THRONE_DREAMING_CITY_WEAPON_NAMES.has(name.toLowerCase()) ||
    /^Reverie Dawn\b/i.test(name)
  );
}

function secondaryActivitySourcesForItem(itemName: string, source: string | undefined): string[] {
  const canonical = canonicalActivitySource(source);
  const updatedDungeon = UPDATED_DUNGEON_WEAPON_SOURCES.get(itemName.trim().toLowerCase());
  if (updatedDungeon) return canonical === updatedDungeon ? [] : [updatedDungeon];
  if (canonical === SHATTERED_THRONE_SOURCE) return [];
  if (!isDreamingCityShatteredThroneLoot(itemName)) return [];
  if (!source || !DREAMING_CITY_SOURCE_PATTERN.test(source)) return [];
  return [SHATTERED_THRONE_SOURCE];
}

function walkPresentationNodeNames(
  nodes: ManifestDefs["DestinyPresentationNodeDefinition"],
  startHashes: number[] | undefined,
): string[] {
  const names: string[] = [];
  const queue = [...(startHashes ?? [])];
  const seen = new Set<number>();
  while (queue.length) {
    const hash = queue.shift();
    if (hash == null || seen.has(hash)) continue;
    seen.add(hash);
    const node = nodes[hash];
    if (!node) continue;
    const name = node.displayProperties?.name?.trim();
    if (name) names.push(name);
    queue.push(...(node.parentNodeHashes ?? []));
  }
  return names;
}

function activityFromPresentationParents(parentNames: readonly string[]): string | undefined {
  for (const name of parentNames) {
    const raid = name.match(/^Raid:\s*(.+)$/i);
    if (raid) return trimActivityLabel(raid[1]!);
    const dungeon = name.match(/^Dungeon:\s*(.+)$/i);
    if (dungeon) return trimActivityLabel(dungeon[1]!);
  }
  return undefined;
}

function activityFromSourceString(sourceString: string | undefined): string | undefined {
  const quoted = sourceString?.match(/"([^"]+)"/);
  if (quoted) return trimActivityLabel(quoted[1]!);
  return cleanSourceString(sourceString);
}

/** Canonical activity/source label for browse filters, e.g. "Root of Nightmares". */
export function normalizeWeaponSource(
  sourceString: string | undefined,
  nodes: ManifestDefs["DestinyPresentationNodeDefinition"],
  parentNodeHashes: number[] | undefined,
): string | undefined {
  const realSource =
    sourceString && PLACEHOLDER_SOURCE_PATTERN.test(sourceString) ? undefined : sourceString;
  const parentNames = walkPresentationNodeNames(nodes, parentNodeHashes);
  return (
    activityFromSourceString(realSource) ??
    activityFromPresentationParents(parentNames) ??
    cleanSourceString(realSource)
  );
}

export function resolveWeaponSources(
  itemName: string,
  sourceString: string | undefined,
  nodes: ManifestDefs["DestinyPresentationNodeDefinition"],
  parentNodeHashes: number[] | undefined,
): ResolvedWeaponSources {
  const source = normalizeWeaponSource(sourceString, nodes, parentNodeHashes);
  const secondary = secondaryActivitySourcesForItem(itemName, source);
  // Collectible-less refresh hashes have no manifest source; the known activity becomes primary.
  return sourceFields(source ?? secondary[0], secondary);
}

function seasonByNumber(
  seasons: ManifestDefs["DestinySeasonDefinition"],
  seasonNumber: number,
): ResolvedWeaponSeason | undefined {
  const season = Object.values(seasons).find((entry) => entry.seasonNumber === seasonNumber);
  if (!season?.seasonNumber) return undefined;
  return {
    seasonNumber: season.seasonNumber,
    seasonName: season.displayProperties?.name || undefined,
  };
}

function seasonByDisplayName(
  seasons: ManifestDefs["DestinySeasonDefinition"],
  displayName: string,
): ResolvedWeaponSeason | undefined {
  const wanted = displayName.trim().toLowerCase();
  const season = Object.values(seasons).find(
    (entry) => entry.displayProperties?.name?.trim().toLowerCase() === wanted,
  );
  if (!season?.seasonNumber) return undefined;
  return {
    seasonNumber: season.seasonNumber,
    seasonName: season.displayProperties?.name || undefined,
  };
}

function seasonFromPresentationParents(
  nodes: ManifestDefs["DestinyPresentationNodeDefinition"],
  seasons: ManifestDefs["DestinySeasonDefinition"],
  parentNodeHashes: number[] | undefined,
): ResolvedWeaponSeason | undefined {
  const queue = [...(parentNodeHashes ?? [])];
  const seen = new Set<number>();
  while (queue.length) {
    const hash = queue.shift();
    if (hash == null || seen.has(hash)) continue;
    seen.add(hash);

    const directSeason = seasons[hash];
    if (directSeason?.seasonNumber != null) {
      return {
        seasonNumber: directSeason.seasonNumber,
        seasonName: directSeason.displayProperties?.name || undefined,
      };
    }

    const node = nodes[hash];
    const name = node?.displayProperties?.name?.trim();
    if (name) {
      if (/^(Season|Episode:)/i.test(name)) {
        const matched = seasonByDisplayName(seasons, name);
        if (matched) return matched;
      }
      const numbered = name.match(/^Season\s+(\d+)(?::\s*.+)?$/i);
      if (numbered) {
        const matched = seasonByNumber(seasons, Number(numbered[1]));
        if (matched) return matched;
      }
    }

    queue.push(...(node?.parentNodeHashes ?? []));
  }
  return undefined;
}

function seasonFromSourceString(
  seasons: ManifestDefs["DestinySeasonDefinition"],
  sourceString: string | undefined,
): ResolvedWeaponSeason | undefined {
  const episode = sourceString?.match(/Episode:\s*([A-Za-z]+)\s+Activities/i);
  if (!episode) return undefined;
  return seasonByDisplayName(seasons, `Episode: ${episode[1]}`);
}

function seasonFromActivitySource(
  seasons: ManifestDefs["DestinySeasonDefinition"],
  source: string | undefined,
): ResolvedWeaponSeason | undefined {
  if (!source) return undefined;
  const trimmed = trimActivityLabel(source);
  const seasonNumber =
    ACTIVITY_INTRO_SEASON[trimmed] ??
    Object.entries(ACTIVITY_INTRO_SEASON).find(
      ([activity]) => activity.toLowerCase() === trimmed.toLowerCase(),
    )?.[1];
  return seasonNumber != null ? seasonByNumber(seasons, seasonNumber) : undefined;
}

/** Best-effort release season for a weapon — manifest links first, activity map as fallback. */
export function resolveWeaponSeason(
  item: DestinyInventoryItemDefinition,
  collectible: DestinyCollectibleDefinition | undefined,
  defs: Pick<
    ManifestDefs,
    "DestinySeasonDefinition" | "DestinyPresentationNodeDefinition"
  >,
): ResolvedWeaponSeason | undefined {
  if (item.seasonHash != null) {
    const season = defs.DestinySeasonDefinition[item.seasonHash];
    if (season?.seasonNumber != null) {
      return {
        seasonNumber: season.seasonNumber,
        seasonName: season.displayProperties?.name || undefined,
      };
    }
  }

  const fromParents = seasonFromPresentationParents(
    defs.DestinyPresentationNodeDefinition,
    defs.DestinySeasonDefinition,
    collectible?.parentNodeHashes,
  );
  if (fromParents) return fromParents;

  const fromEpisode = seasonFromSourceString(
    defs.DestinySeasonDefinition,
    collectible?.sourceString,
  );
  if (fromEpisode) return fromEpisode;

  const source = normalizeWeaponSource(
    collectible?.sourceString,
    defs.DestinyPresentationNodeDefinition,
    collectible?.parentNodeHashes,
  );
  return seasonFromActivitySource(defs.DestinySeasonDefinition, source);
}

const lower = (value: string) => value.toLowerCase();

export function isRaidSource(source: string | undefined): boolean {
  const canonical = canonicalRaidSource(source);
  if (!canonical) return false;
  return RAID_SOURCE_LABEL_SET.has(canonical.toLowerCase());
}

export function isDungeonSource(source: string | undefined): boolean {
  const canonical = canonicalActivitySource(source);
  if (!canonical) return false;
  return DUNGEON_SOURCE_LABEL_SET.has(canonical.toLowerCase());
}

export function isCuratedActivitySource(source: string | undefined): boolean {
  const canonical = canonicalActivitySource(source);
  if (!canonical) return false;
  return CURATED_SOURCE_LABEL_SET.has(canonical.toLowerCase());
}

/** True when a raid label or shorthand alias matches the typed query. */
export function raidSourceMatchesQuery(source: string, query: string): boolean {
  const ql = query.trim().toLowerCase();
  if (!ql) return true;
  const label = trimActivityLabel(source).toLowerCase();
  if (label.includes(ql)) return true;
  const aliases = RAID_SOURCE_ALIASES[source] ?? RAID_SOURCE_ALIASES[trimActivityLabel(source)] ?? [];
  return aliases.some((alias) => alias.includes(ql) || ql.includes(alias));
}

/** True when a curated activity label or shorthand alias matches the typed query. */
export function activitySourceMatchesQuery(source: string, query: string): boolean {
  const ql = query.trim().toLowerCase();
  if (!ql) return true;
  const label = trimActivityLabel(source).toLowerCase();
  if (label.includes(ql)) return true;
  const aliases =
    ACTIVITY_SOURCE_ALIASES[source] ?? ACTIVITY_SOURCE_ALIASES[trimActivityLabel(source)] ?? [];
  return aliases.some((alias) => alias.includes(ql) || ql.includes(alias));
}

/**
 * {@link matchesWeaponSource} for callers that pre-lower/trim the needles once
 * per filter pass instead of per weapon.
 */
export function matchesWeaponSourceLowered(
  source: string | undefined,
  loweredNeedles: readonly string[],
  sources: readonly string[] = [],
): boolean {
  return sourceLabels({ source, sources }).some((label) => {
    const canonical = canonicalActivitySource(label);
    if (!canonical) return false;
    const haystack = lower(canonical);
    return loweredNeedles.some((needle) => needle.length > 0 && haystack.includes(needle));
  });
}

/** True when a weapon source matches any selected activity fragment (substring, case-insensitive). */
export function matchesWeaponSource(
  source: string | undefined,
  selected: string[] | undefined,
  sources: readonly string[] = [],
): boolean {
  if (!selected?.length) return true;
  return matchesWeaponSourceLowered(
    source,
    selected.map((entry) => lower(entry.trim())),
    sources,
  );
}
