/** Armor 3.0 stat + slot constants (hashes verified against the live manifest). */

export const STAT_ORDER = [
  "weapons",
  "health",
  "class",
  "grenade",
  "super",
  "melee",
] as const;
export type StatKey = (typeof STAT_ORDER)[number];

/** Six-stat vector, always in STAT_ORDER. */
export type StatArray = [number, number, number, number, number, number];

export const STAT_HASHES: Record<StatKey, number> = {
  weapons: 2996146975,
  health: 392767087,
  class: 1943323491,
  grenade: 1735777505,
  super: 144602215,
  melee: 4244567218,
};

export const STAT_LABELS: Record<StatKey, string> = {
  weapons: "Weapons",
  health: "Health",
  class: "Class",
  grenade: "Grenade",
  super: "Super",
  melee: "Melee",
};

/** UI stat order, top-to-bottom / left-to-right (icon-only rows map back to STAT_ORDER indices). */
export const STAT_DISPLAY_ORDER = [
  "health",
  "melee",
  "grenade",
  "super",
  "class",
  "weapons",
] as const satisfies readonly StatKey[];

/** Per-stat icon paths resolved from the manifest (undefined until it's loaded). */
export type StatIconMap = Record<StatKey, string | undefined>;

/** Reverse map: stat hash -> index in STAT_ORDER (0..5). */
export const STAT_HASH_TO_INDEX: Record<number, number> = Object.fromEntries(
  STAT_ORDER.map((key, i) => [STAT_HASHES[key], i]),
);

/** Plug category identifier for the intrinsic armor stat-roll plugs (the true base roll). */
export const ARMOR_STATS_PLUG_CATEGORY = "armor_stats";

/** Masterwork (MW5) adds +5 to each of the 3 off-archetype stats. Archetype stats (30/25/20 on T5) are fixed and unaffected. */
export const MASTERWORK_OFF_STAT_BONUS = 5;

/** Artifice armor intrinsic perk — its presence marks a piece as artifice (a free +3 stat mod slot). */
export const ARTIFICE_PERK_HASH = 3727270518;

/** An artifice mod grants +3 to one stat, at no energy cost. */
export const ARTIFICE_MOD_BONUS = 3;

/**
 * Tier-5 armor tuning socket plug category. Its available plugs (component 310)
 * reveal the piece's rolled "tuned stat" — the stat every directional plug adds +5 to.
 */
export const TUNING_PLUG_CATEGORY = "tuning";

/** Directional tuning: +5 to the piece's tuned stat, −5 to a chosen other stat, 0 energy. */
export const DIRECTIONAL_TUNING_BONUS = 5;

/** Balanced Tuning plug item hash (verified against the live manifest). */
export const BALANCED_TUNING_PLUG_HASH = 3122197216;

/**
 * Balanced Tuning grants +1 to each of the 3 off-archetype stats — NOT all six.
 * The manifest lists +1 to all six, but (like masterwork) the archetype stats are
 * capped, so only the 3 off-archetype stats actually move. Verified with Noah.
 */
export const BALANCED_TUNING_OFF_STAT_BONUS = 1;

/**
 * The 3 off-archetype stat indices = the 3 lowest base-roll stats (0 at base,
 * bumped to 5 by MW). These are the stats masterwork and Balanced Tuning affect;
 * the other 3 are the fixed archetype stats (30/25/20). Shared by applyMasterwork
 * and the tuning model so they stay consistent.
 */
export function offArchetypeIndices(base: StatArray): number[] {
  return base
    .map((_, i) => i)
    .sort((a, b) => base[a] - base[b])
    .slice(0, 3);
}

/** Armor inventory bucket hash -> slot. */
export const ARMOR_BUCKETS = {
  3448274439: "helmet",
  3551918588: "arms",
  14239492: "chest",
  20886954: "legs",
  1585787867: "classItem",
} as const;

export type ArmorSlot = (typeof ARMOR_BUCKETS)[keyof typeof ARMOR_BUCKETS];
export const ARMOR_SLOTS: ArmorSlot[] = [
  "helmet",
  "arms",
  "chest",
  "legs",
  "classItem",
];
export const SLOT_LABELS: Record<ArmorSlot, string> = {
  helmet: "Helmet",
  arms: "Arms",
  chest: "Chest",
  legs: "Legs",
  classItem: "Class Item",
};

export const CLASS_NAMES: Record<number, string> = {
  0: "Titan",
  1: "Hunter",
  2: "Warlock",
};
