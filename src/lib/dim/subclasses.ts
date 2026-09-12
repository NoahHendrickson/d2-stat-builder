import type { Subclass } from "../armory/fragments";

/**
 * Subclass ITEM hashes per (subclass, classType 0 Titan | 1 Hunter | 2 Warlock).
 *
 * Kept here for synchronous identification of saved subclass items, including
 * share links and builder restoration before the manifest has loaded.
 * Subclass item hashes have been stable since their 3.0 reworks.
 * All 18 verified against manifest 244164.26.06.16.2053-2-bnet.65465
 * (itemType 16 + matching classType).
 */
export const SUBCLASS_ITEM_HASHES: Record<Subclass, Record<number, number>> = {
  Arc: {
    0: 2932390016, // Striker
    1: 2328211300, // Arcstrider
    2: 3168997075, // Stormcaller
  },
  Solar: {
    0: 2550323932, // Sunbreaker
    1: 2240888816, // Gunslinger
    2: 3941205951, // Dawnblade
  },
  Void: {
    0: 2842471112, // Sentinel
    1: 2453351420, // Nightstalker
    2: 2849050827, // Voidwalker
  },
  Stasis: {
    0: 613647804, // Behemoth
    1: 873720784, // Revenant
    2: 3291545503, // Shadebinder
  },
  Strand: {
    0: 242419885, // Berserker
    1: 3785442599, // Threadrunner
    2: 4204413574, // Broodweaver
  },
  Prismatic: {
    0: 1616346845, // Prismatic Titan
    1: 4282591831, // Prismatic Hunter
    2: 3893112950, // Prismatic Warlock
  },
};

/**
 * DestinySocketCategory for the Super ability socket (DIM `SocketCategoryHashes.Super`).
 * Index is not fixed — socket 0 is the class ability — so look this up per item.
 */
export const SUPER_SOCKET_CATEGORY_HASH = 457473665;
export const SUPER_SOCKET_COUNT = 1;

/**
 * The ability sockets a loadout can pin, one plug each. Every subclass item lays them
 * out as 0 class ability, 1 movement, 2 Super, 3 melee, 4 grenade (verified against the
 * live manifest for all 18), but the index is looked up per item from the socket type's
 * plug whitelist — its category identifier ends in the suffix below (e.g.
 * `hunter.arc.class_abilities`, `shared.solar.grenades`). Prismatic's transcendence
 * sockets (5–6) have no plug set and stay untouched.
 */
export const ABILITY_KINDS = ["super", "classAbility", "movement", "melee", "grenade"] as const;
export type AbilityKind = (typeof ABILITY_KINDS)[number];
export const ABILITY_PLUG_CATEGORY_SUFFIX: Record<AbilityKind, string> = {
  super: "supers",
  classAbility: "class_abilities",
  movement: "movement",
  melee: "melee",
  grenade: "grenades",
};
export const ABILITY_LABELS: Record<AbilityKind, string> = {
  super: "Super",
  classAbility: "Class ability",
  movement: "Jump",
  melee: "Melee",
  grenade: "Grenade",
};
/** Super + class ability + movement + melee + grenade. */
export const ABILITY_SOCKET_COUNT = ABILITY_KINDS.length;

/**
 * Strand class abilities and jumps reuse Stasis icon files (`iconHash` points at
 * the Stasis plug). The game tints them; UI applies Strand green via mix-blend.
 */
export function isStrandSharedAbilityIcon(plugCategory: string | undefined): boolean {
  return (
    !!plugCategory &&
    (plugCategory.endsWith(".strand.class_abilities") ||
      plugCategory.endsWith(".strand.movement"))
  );
}

/**
 * First fragment socket index on a subclass item, used for the DIM handoff's
 * socketOverrides. Verified against the live manifest's socketEntries: every
 * non-Prismatic subclass has fragments at sockets 7–12; Prismatic puts
 * transcendence + grenade at 5–6 and aspects at 7–8, pushing fragments to 9–14.
 * A wrong index degrades to "fragment ignored" in DIM, never an error.
 */
export const FRAGMENT_SOCKET_START: Record<Subclass, number> = {
  Arc: 7,
  Solar: 7,
  Void: 7,
  Stasis: 7,
  Strand: 7,
  Prismatic: 9,
};

export const ASPECT_SOCKET_COUNT = 2;
export const FRAGMENT_SOCKET_COUNT = 6;

export function aspectSocketStart(subclass: Subclass): number {
  return FRAGMENT_SOCKET_START[subclass] - ASPECT_SOCKET_COUNT;
}

/** Reverse lookup: subclass item hash → Subclass. Built once from SUBCLASS_ITEM_HASHES. */
const ITEM_HASH_TO_SUBCLASS: Map<number, Subclass> = (() => {
  const m = new Map<number, Subclass>();
  for (const subclass of Object.keys(SUBCLASS_ITEM_HASHES) as Subclass[]) {
    for (const hash of Object.values(SUBCLASS_ITEM_HASHES[subclass])) {
      m.set(hash, subclass);
    }
  }
  return m;
})();

export function subclassFromItemHash(itemHash: number): Subclass | undefined {
  return ITEM_HASH_TO_SUBCLASS.get(itemHash);
}
