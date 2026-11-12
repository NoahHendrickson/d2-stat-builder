import { normalizeWeaponIndex } from "./intern-weapons";
import { expandWeaponQueryAliases } from "./aliases";
import {
  mergeWeaponFilters,
  parseWeaponQuery,
  weaponQueryVocabulary,
  type PatternFilter,
  type UnknownFilter,
} from "./query-language";
import { buildWeaponNameIndex } from "./weapon-name-index";
import { canonicalActivitySource, sourceLabels } from "./weapon-provenance";
import { createWeaponSearcher } from "./weapon-searcher";
import {
  currentWeaponPerkPoolVersions,
  isCatalogWeapon,
} from "./weapon-variants";
import {
  collectColumnPerks,
  collectComboPartners,
  collectFacets,
  filterWeapons,
  rankWeaponResults,
  weaponsMatchingTextQuery,
  type WeaponFilters,
  type WeaponSort,
} from "./search";
import type { WeaponIndex, WeaponSummary } from "./types";
import { isPatternComplete, patternFor, type PatternProgress } from "@/lib/bungie/patterns";

const collator = new Intl.Collator();

export interface WeaponSearchResult {
  results: WeaponSummary[];
  /** Filter tokens that mean nothing; when there are any, `results` is empty. */
  unknown: UnknownFilter[];
}

/** A craftable weapon whose pattern is (or isn't) finished; no progress record counts as unfinished. */
function matchesPattern(
  weapon: WeaponSummary,
  filter: PatternFilter,
  patterns: Readonly<Record<string, PatternProgress>>,
): boolean {
  if (!weapon.craftable) return false;
  const progress = patternFor(patterns, weapon.name);
  return (progress !== undefined && isPatternComplete(progress)) === (filter === "complete");
}

/** Built once per downloaded catalog, independent of React renders. */
export function createWeaponCatalog(raw: WeaponIndex) {
  const index = normalizeWeaponIndex(raw);
  const weapons = index.weapons.filter(isCatalogWeapon);
  const names = buildWeaponNameIndex(weapons);
  const searcher = createWeaponSearcher(weapons);
  const representative = new Map<number, WeaponSummary>();
  // Names with several current perk pools show one row per pool; the label tells
  // them apart (usually the activity that drops that version).
  const poolLabels = new Map<number, string>();
  // Perk-pool fingerprints and version grouping do not depend on the query.
  // The old browser rebuilt these on every keystroke (and every facet preview).
  for (const versions of names.byName.values()) {
    const pools = currentWeaponPerkPoolVersions(versions);
    for (const pool of pools) {
      for (const hash of pool.hashes) representative.set(hash, pool.weapon);
      if (pools.length > 1) poolLabels.set(pool.weapon.hash, pool.label);
    }
  }
  /** Text matches per search text, and the bare keyword's weapons when the text is one. */
  const textCache = new Map<string, { matches: WeaponSummary[]; lead?: Set<number> }>();
  const facets = collectFacets(weapons);
  const vocabulary = weaponQueryVocabulary({
    types: facets.type!.map((f) => f.value),
    elements: facets.element!.map((f) => f.value),
  });
  // Offer the same canonical activity labels the source filter matches against,
  // so every option in the list yields results.
  const sources = new Set<string>();
  for (const weapon of weapons) {
    for (const label of sourceLabels(weapon)) {
      const canonical = canonicalActivitySource(label);
      if (canonical) sources.add(canonical);
    }
  }
  facets.source = [...sources]
    .sort(collator.compare)
    .map((value) => ({ value, count: 0 }));
  const columns = collectColumnPerks(weapons, index.perks);
  for (const key of ["trait", "trait1", "trait2", "originTrait", "gear"] as const) {
    facets[key] = columns[key].map((p) => ({ value: p.name, count: p.count }));
  }
  facets.perkCombo = [
    ...new Set([...columns.trait1, ...columns.trait2].map((p) => p.name)),
  ]
    .sort(collator.compare)
    .map((value) => ({ value, count: 0 }));

  /** Whether the query has a working `pattern:` filter, so the caller should load progress. */
  function usesPatterns(query: string): boolean {
    const parsed = parseWeaponQuery(query, vocabulary);
    return parsed.pattern !== undefined && parsed.unknown.length === 0;
  }

  function search(
    query: string,
    filters: WeaponFilters,
    sort: WeaponSort,
    /** The signed-in player's pattern progress by weapon name, for `pattern:`. */
    patterns?: Readonly<Record<string, PatternProgress>>,
  ): WeaponSearchResult {
    const parsed = parseWeaponQuery(query, vocabulary);
    // An unknown filter (`is:arcc`) means nothing, so it matches nothing.
    if (parsed.unknown.length > 0) return { results: [], unknown: parsed.unknown };
    // A `pattern:` search matches nothing until the player's progress is given.
    const pattern = parsed.pattern;
    if (pattern && !patterns) return { results: [], unknown: [] };
    const text = expandWeaponQueryAliases(parsed.text).toLowerCase();
    let cached = textCache.get(text);
    if (!cached) {
      // Never cap candidates before applying facets: rare matching rolls must survive.
      let matches = weaponsMatchingTextQuery(
        weapons,
        searcher,
        text,
        weapons.length,
        names,
      );
      // A word like "arc" or "smg" typed alone: its weapons, then the text matches.
      let lead: Set<number> | undefined;
      if (parsed.keyword) {
        const hits = filterWeapons(weapons, parsed.keyword, index.perks);
        const keywordHashes = new Set(hits.map((w) => w.hash));
        matches = [...hits, ...matches.filter((w) => !keywordHashes.has(w.hash))];
        lead = keywordHashes;
      }
      cached = { matches, lead };
      if (textCache.size >= 16)
        textCache.delete(textCache.keys().next().value!);
      textCache.set(text, cached);
    }
    const filtered = filterWeapons(
      cached.matches,
      mergeWeaponFilters(filters, parsed.filters),
      index.perks,
    );
    const unique = new Map<number, WeaponSummary>();
    for (const weapon of filtered) {
      const primary = representative.get(weapon.hash) ?? weapon;
      // Judged on the row that shows (its pool's representative), not the version that matched.
      if (pattern && !matchesPattern(primary, pattern, patterns!)) continue;
      unique.set(primary.hash, primary);
    }
    const results = rankWeaponResults(
      [...unique.values()],
      text,
      sort,
      names,
      cached.lead,
    );
    return { results, unknown: [] };
  }

  /** Version label for a result row whose name has more than one current perk pool. */
  function poolLabel(hash: number): string | undefined {
    return poolLabels.get(hash);
  }

  /** Perk combo values once `first` is picked: only perks that roll opposite it. */
  function comboPartners(first: string) {
    return collectComboPartners(weapons, index.perks, first).map((p) => ({
      value: p.name,
      count: p.count,
    }));
  }

  // `allWeapons` keeps the superseded versions browse hides: old copies still drop
  // (and sit in vaults) under those hashes.
  return { ...index, weapons, allWeapons: index.weapons, facets, search, usesPatterns, poolLabel, comboPartners };
}

export type WeaponCatalog = ReturnType<typeof createWeaponCatalog>;

/**
 * The catalog entry for an owned weapon. Owned copies are often an older or reissued
 * version the catalog lists under another hash; a same-name version shares the stat
 * curves and perk bonuses.
 */
export function catalogWeaponFor(
  catalog: WeaponCatalog | undefined,
  item: { itemHash: number; name: string },
): WeaponSummary | undefined {
  return (
    catalog?.weapons.find((w) => w.hash === item.itemHash) ??
    catalog?.weapons.find((w) => w.name === item.name)
  );
}
