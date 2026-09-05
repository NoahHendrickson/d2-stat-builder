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

/** Plug category identifier for the archetype plug on Armor 3.0 pieces (e.g. "Gunner"). */
export const ARMOR_ARCHETYPE_PLUG_CATEGORY = "armor_archetypes";

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

/**
 * General armor stat-mod plug category — the socketable +10 ("major") and +5
 * ("minor") stat mods. Same category DIM/D2ArmorPicker key on.
 */
export const GENERAL_MOD_CATEGORY = "enhancements.v2_general";

/**
 * Usable artifice mod-socket category (`Empty Mod Socket` / Forged +3 mods).
 * Deliberately excludes `enhancements.artifice.exotic` — that is the unpaid
 * "Locked Artifice Socket" / "Upgrade to Artifice Armor" payment slot. Exotic
 * class items still ship that locked socket in the def even though Edge of Fate
 * removed their artifice capability in favor of Tier-5 tuning.
 */
export const ARTIFICE_MOD_CATEGORY = "enhancements.artifice";

/** Every armor mod plug category starts with this (slot-specific, activity, general…). */
export const MOD_CATEGORY_PREFIX = "enhancements.";

/** general = stat mod; other = slot-specific / activity; tuning; artifice. */
export type ArmorSocketKind = "general" | "other" | "tuning" | "artifice";

/**
 * Which kind of armor mod socket a plug category belongs to — the single classifier
 * shared by socket discovery (normalize.ts) and mod lookup (plug-info.ts), so the
 * planner's `socket.kind === plug.kind` check can never drift between the two.
 * Undefined for anything that isn't an armor mod (shaders, perks, exotic payment plugs).
 */
export function plugKindForCategory(cat: string): ArmorSocketKind | undefined {
  if (cat === GENERAL_MOD_CATEGORY) return "general";
  if (cat === ARTIFICE_MOD_CATEGORY) return "artifice";
  if (cat.includes(TUNING_PLUG_CATEGORY)) return "tuning";
  if (cat.startsWith(MOD_CATEGORY_PREFIX) && !cat.includes(".exotic")) return "other";
  return undefined;
}

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

/**
 * The tertiary archetype stat index = the 3rd-highest base-roll stat (fixed at 20
 * on Tier 5). Complement of offArchetypeIndices; ties resolve in STAT_ORDER order
 * (stable sort). Only meaningful for Armor 3.0 pieces with a real archetype shape.
 */
export function tertiaryStatIndex(base: StatArray): number {
  return base.map((_, i) => i).sort((a, b) => base[b] - base[a])[2];
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
