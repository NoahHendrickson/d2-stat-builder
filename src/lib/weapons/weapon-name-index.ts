import type { WeaponSummary } from "./types";
import { isCatalogWeapon } from "./weapon-variants";

/**
 * Precomputed name lookup built once per weapon catalog load.
 *
 * Weapon-name autocomplete runs on every keystroke; rebuilding a name→count map
 * and lowercasing every name each time is wasteful. This caches the distinct
 * names (display + parallel lowercase), their share counts, and the weapons that
 * carry each name so name search becomes a scan over precomputed arrays plus O(1)
 * expansion instead of repeated allocation.
 */
export interface WeaponNameIndex {
  /** Distinct weapon names in display case (sorted ascending). */
  names: string[];
  /** Parallel lowercase names for matching (same order as {@link names}). */
  namesLower: string[];
  /** Distinct catalog entries sharing each name. */
  countByName: Map<string, number>;
  /** Name (display case) → every weapon summary carrying it. */
  byName: Map<string, WeaponSummary[]>;
}

/** Build the reusable name index for a weapon catalog. */
export function buildWeaponNameIndex(weapons: WeaponSummary[]): WeaponNameIndex {
  const byName = new Map<string, WeaponSummary[]>();
  const countByName = new Map<string, number>();
  for (const weapon of weapons) {
    const list = byName.get(weapon.name);
    if (list) list.push(weapon);
    else byName.set(weapon.name, [weapon]);
    if (isCatalogWeapon(weapon)) {
      countByName.set(weapon.name, (countByName.get(weapon.name) ?? 0) + 1);
    }
  }

  const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
  const namesLower = names.map((name) => name.toLowerCase());
  return { names, namesLower, countByName, byName };
}
