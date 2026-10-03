// Weapon types by item category (DestinyItemCategoryDefinition), DIM's `is:` names.
// Most specific first: a linear fusion rifle also carries the fusion rifle category.
export const WEAPON_CATEGORIES: readonly [name: string, categoryHash: number][] = [
  ["linearfusionrifle", 1504945536],
  ["tracerifle", 2489664120],
  ["submachine", 3954685534],
  ["grenadelauncher", 153950757],
  ["bow", 3317538576],
  ["glaive", 3871742104],
  ["autorifle", 5],
  ["handcannon", 6],
  ["pulserifle", 7],
  ["scoutrifle", 8],
  ["fusionrifle", 9],
  ["sniperrifle", 10],
  ["shotgun", 11],
  ["machinegun", 12],
  ["rocketlauncher", 13],
  ["sidearm", 14],
  ["sword", 54],
];

/** Other names for a weapon type, as DIM takes them. */
export const WEAPON_TYPE_ALIASES: Readonly<Record<string, string>> = {
  lfr: "linearfusionrifle",
  lmg: "machinegun",
  smg: "submachine",
  submachinegun: "submachine",
};

/** The weapon type of a weapon definition's categories, e.g. "handcannon". */
export function weaponTypeOf(categoryHashes: readonly number[] | undefined): string | undefined {
  if (!categoryHashes?.length) return undefined;
  return WEAPON_CATEGORIES.find(([, hash]) => categoryHashes.includes(hash))?.[0];
}
