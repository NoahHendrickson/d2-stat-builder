import { normalizeWeaponIndex } from "./intern-weapons";
import { expandWeaponQueryAliases } from "./aliases";
import { mergeWeaponFilters, planWeaponTextSearch } from "./query-language";
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

const collator = new Intl.Collator();

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
  const textCache = new Map<string, WeaponSummary[]>();
  const facets = collectFacets(weapons);
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
  for (const key of ["trait", "trait1", "trait2", "originTrait"] as const) {
    facets[key] = columns[key].map((p) => ({ value: p.name, count: p.count }));
  }
  facets.perkCombo = [
    ...new Set([...columns.trait1, ...columns.trait2].map((p) => p.name)),
  ]
    .sort(collator.compare)
    .map((value) => ({ value, count: 0 }));

  function search(query: string, filters: WeaponFilters, sort: WeaponSort) {
    const plan = planWeaponTextSearch(query);
    const text = expandWeaponQueryAliases(plan.searchText).toLowerCase();
    let matches = textCache.get(text);
    if (!matches) {
      // Never cap candidates before applying facets: rare matching rolls must survive.
      matches = weaponsMatchingTextQuery(
        weapons,
        searcher,
        text,
        weapons.length,
        names,
      );
      if (textCache.size >= 16)
        textCache.delete(textCache.keys().next().value!);
      textCache.set(text, matches);
    }
    const filtered = filterWeapons(
      matches,
      mergeWeaponFilters(filters, plan.filters),
      index.perks,
    );
    const unique = new Map<number, WeaponSummary>();
    for (const weapon of filtered) {
      const primary = representative.get(weapon.hash) ?? weapon;
      unique.set(primary.hash, primary);
    }
    return rankWeaponResults([...unique.values()], text, sort, names);
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

  return { ...index, weapons, facets, search, poolLabel, comboPartners };
}

export type WeaponCatalog = ReturnType<typeof createWeaponCatalog>;
