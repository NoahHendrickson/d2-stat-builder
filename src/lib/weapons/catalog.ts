import { normalizeWeaponIndex } from "./intern-weapons";
import { expandWeaponQueryAliases } from "./aliases";
import { mergeWeaponFilters, planWeaponTextSearch } from "./query-language";
import { buildWeaponNameIndex } from "./weapon-name-index";
import { createWeaponSearcher } from "./weapon-searcher";
import {
  currentWeaponPerkPoolVersions,
  isCatalogWeapon,
} from "./weapon-variants";
import {
  collectColumnPerks,
  collectFacets,
  collectPerks,
  filterWeapons,
  rankWeaponResults,
  weaponsMatchingTextQuery,
  type WeaponFilters,
  type WeaponSort,
} from "./search";
import type { WeaponIndex, WeaponSummary } from "./types";

/** Built once per downloaded catalog, independent of React renders. */
export function createWeaponCatalog(raw: WeaponIndex) {
  const index = normalizeWeaponIndex(raw);
  const weapons = index.weapons.filter(isCatalogWeapon);
  const names = buildWeaponNameIndex(weapons);
  const searcher = createWeaponSearcher(weapons);
  const representative = new Map<number, WeaponSummary>();
  // Perk-pool fingerprints and version grouping do not depend on the query.
  // The old browser rebuilt these on every keystroke (and every facet preview).
  for (const versions of names.byName.values()) {
    for (const pool of currentWeaponPerkPoolVersions(versions)) {
      for (const hash of pool.hashes) representative.set(hash, pool.weapon);
    }
  }
  const textCache = new Map<string, WeaponSummary[]>();
  const facets = collectFacets(weapons);
  facets.source = [
    ...new Set(
      weapons.flatMap((w) => w.sources ?? (w.source ? [w.source] : [])),
    ),
  ]
    .sort()
    .map((value) => ({ value, count: 0 }));
  const columns = collectColumnPerks(weapons, index.perks);
  for (const key of ["trait1", "trait2", "originTrait"] as const) {
    facets[key] = columns[key].map((p) => ({ value: p.name, count: p.count }));
  }
  facets.perks = collectPerks(weapons, index.perks).map((p) => ({
    value: p.name,
    count: p.count,
  }));
  facets.perkCombo = [
    ...new Set([...columns.trait1, ...columns.trait2].map((p) => p.name)),
  ]
    .sort()
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
    return rankWeaponResults(
      [...unique.values()],
      text,
      sort,
      undefined,
      names,
    );
  }

  return { ...index, weapons, facets, search };
}

export type WeaponCatalog = ReturnType<typeof createWeaponCatalog>;
