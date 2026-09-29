import type { PerkRef, WeaponIndex, WeaponSummary } from "./types";
import { isCatalogWeapon } from "./weapon-variants";

type CompactWeapon = Omit<WeaponSummary, "perks" | "perksLower" | "perkHashes">;
export type CompactWeaponIndex = Omit<
  WeaponIndex,
  "weapons" | "weaponsByPerkName"
> & {
  schema: 1;
  weapons: CompactWeapon[];
};

/** The browser reads stat modifiers by name (`stats`); drop the hash-keyed copy. */
function compactPerk(perk: PerkRef): PerkRef {
  const { statMods, ...compact } = perk;
  void statMods;
  return compact;
}

/** Ship each perk once. Names, hashes, and reverse lookups duplicate the column indices. */
export function compactWeaponIndex(index: WeaponIndex): CompactWeaponIndex {
  return {
    schema: 1,
    version: index.version,
    generatedAt: index.generatedAt,
    perks: index.perks.map(compactPerk),
    damageTypes: index.damageTypes,
    weaponTypes: index.weaponTypes,
    ammoTypes: index.ammoTypes,
    statCurves: index.statCurves,
    weapons: index.weapons.filter(isCatalogWeapon).map((weapon) => {
      const { perks, perksLower, perkHashes, ...compact } = weapon;
      void perks;
      void perksLower;
      void perkHashes;
      return compact;
    }),
  };
}

/**
 * Rebuild the per-weapon search fields from the shared perk table. Perk hashes
 * are not restored: nothing in the browser looks weapons up by plug hash.
 */
export function expandWeaponIndex(index: CompactWeaponIndex): WeaponIndex {
  if (
    index.schema !== 1 ||
    !Array.isArray(index.weapons) ||
    !Array.isArray(index.perks) ||
    !index.version
  ) {
    throw new Error(
      "The weapon catalog is incomplete. Please try again later.",
    );
  }
  return {
    ...index,
    weaponsByPerkName: {},
    weapons: index.weapons.map((weapon) => {
      const perks = new Set<string>();
      for (const column of weapon.columns) {
        for (const i of column.perkIndices) {
          const perk = index.perks[i];
          if (!perk)
            throw new Error(
              "The weapon catalog contains an invalid perk reference.",
            );
          perks.add(perk.name);
        }
      }
      const names = [...perks];
      return {
        ...weapon,
        perks: names,
        perksLower: names.map((name) => name.toLowerCase()),
      };
    }),
  };
}
