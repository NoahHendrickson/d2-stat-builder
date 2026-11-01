// Words both searches take after `is:` (the Items tab's and /weapons'), each mapped to
// the canonical name it stands for. Keys are lower-case with no spaces or punctuation.
// The Items search turns the names into manifest numbers; the weapon search matches
// them against catalog values. Weapon types aren't here: each search takes them from its
// own source (manifest categories, catalog types).

export const RARITY_WORDS = {
  exotic: "Exotic",
  legendary: "Legendary",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
} as const;
export type Rarity = (typeof RARITY_WORDS)[keyof typeof RARITY_WORDS];

export const AMMO_WORDS = { primary: "Primary", special: "Special", heavy: "Heavy" } as const;
export type Ammo = (typeof AMMO_WORDS)[keyof typeof AMMO_WORDS];

export const CHAMPION_WORDS = {
  barrier: "Barrier",
  antibarrier: "Barrier",
  shieldpiercing: "Barrier",
  overload: "Overload",
  disruption: "Overload",
  unstoppable: "Unstoppable",
  stagger: "Unstoppable",
} as const;
export type Champion = (typeof CHAMPION_WORDS)[keyof typeof CHAMPION_WORDS];
/** Champion words that read as something else on their own, so they count only after `is:`. */
export const CHAMPION_SYNONYMS: ReadonlySet<string> = new Set([
  "antibarrier",
  "shieldpiercing",
  "disruption",
  "stagger",
]);

/** Lower-case element names. Prismatic is a subclass's; no weapon has it. */
export const ELEMENT_WORDS = ["kinetic", "arc", "solar", "void", "stasis", "strand", "prismatic"] as const;
/** `is:light` / `is:dark`: the elements on each side (Prismatic is neither). */
export const ELEMENT_SIDES = {
  light: ["arc", "solar", "void"],
  dark: ["stasis", "strand"],
} as const satisfies Record<string, readonly (typeof ELEMENT_WORDS)[number][]>;

export const WEAPON_SLOT_WORDS = {
  kineticslot: "Kinetic",
  energyslot: "Energy",
  powerslot: "Power",
} as const;
export type WeaponSlot = (typeof WEAPON_SLOT_WORDS)[keyof typeof WEAPON_SLOT_WORDS];
/** Slot names that read as something else on their own ("power"), so they count only after `is:`. */
export const WEAPON_SLOT_ALIASES = { energy: "Energy", power: "Power" } as const;

/** Grenade launchers come in two ammo types; these words name the type and its ammo. */
export const GRENADE_LAUNCHER_AMMO_WORDS = {
  heavygrenadelauncher: "Heavy",
  specialgrenadelauncher: "Special",
} as const;

/** `table[word]`, without reaching inherited keys like `constructor` or `__proto__`. */
export function lookupWord<T>(table: Readonly<Record<string, T>>, word: string): T | undefined {
  return Object.hasOwn(table, word) ? table[word] : undefined;
}
