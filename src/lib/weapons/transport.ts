import type { WeaponIndex, WeaponSummary } from "./types";
import { isCatalogWeapon } from "./weapon-variants";

type CompactWeapon = Omit<WeaponSummary, "perks" | "perksLower" | "perkHashes">;
export type CompactWeaponIndex = Omit<
  WeaponIndex,
  "weapons" | "weaponsByPerkName"
> & {
  schema: 1;
  weapons: CompactWeapon[];
};

/** Ship each perk once. Names, hashes, and reverse lookups duplicate the column indices. */
export function compactWeaponIndex(index: WeaponIndex): CompactWeaponIndex {
  return {
    schema: 1,
    version: index.version,
    generatedAt: index.generatedAt,
    perks: index.perks,
    damageTypes: index.damageTypes,
    weaponTypes: index.weaponTypes,
    ammoTypes: index.ammoTypes,
    weapons: index.weapons.filter(isCatalogWeapon).map((weapon) => {
      const { perks, perksLower, perkHashes, ...compact } = weapon;
      void perks;
      void perksLower;
      void perkHashes;
      return compact;
    }),
  };
}

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
      const refs = weapon.columns.flatMap((column) =>
        column.perkIndices.map((i) => {
          const perk = index.perks[i];
          if (!perk)
            throw new Error(
              "The weapon catalog contains an invalid perk reference.",
            );
          return perk;
        }),
      );
      const perks = [...new Set(refs.map((perk) => perk.name))];
      return {
        ...weapon,
        perks,
        perksLower: perks.map((name) => name.toLowerCase()),
        perkHashes: [
          ...new Set(
            refs.flatMap((perk) => [
              perk.hash,
              ...(perk.alternateHashes ?? []),
            ]),
          ),
        ],
      };
    }),
  };
}
