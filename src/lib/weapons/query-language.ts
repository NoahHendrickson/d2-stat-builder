import { expandWeaponQueryAliases } from "./aliases";
import type { ExcludableFacet, WeaponFilters } from "./search";

/** Result of parsing a raw search box string into structured filters + leftover free text. */
export interface ParsedWeaponQuery {
  filters: WeaponFilters;
  /** Non-keyword terms, rejoined — feed this to name/fuzzy search. */
  text: string;
  /**
   * Filter tokens the parser doesn't know (`is:arcc`, `elemnt:solar`). They match
   * nothing rather than falling through to fuzzy text, which would match junk.
   */
  unknown: string[];
}

/** `WeaponFilters` fields that are OR-within string arrays — the single source of truth for merging. */
export const ARRAY_FACET_KEYS = [
  "element",
  "type",
  "ammo",
  "rarity",
  "frame",
  "source",
  "season",
  "slot",
  "trait1",
  "trait2",
  "trait",
  "originTrait",
  "gear",
  "champion",
  "perks",
  "craftable",
  "name",
] as const satisfies readonly (keyof WeaponFilters)[];

/** `key:` tokens that map straight onto an OR-within facet array. */
const FACET_KEYS: Readonly<
  Record<
    string,
    "element" | "type" | "ammo" | "slot" | "rarity" | "frame" | "source" | "season" | "gear" | "champion"
  >
> = {
  element: "element",
  damage: "element",
  type: "type",
  weapon: "type",
  ammo: "ammo",
  slot: "slot",
  rarity: "rarity",
  tier: "rarity",
  frame: "frame",
  archetype: "frame",
  source: "source",
  activity: "source",
  season: "season",
  gear: "gear",
  barrel: "gear",
  mag: "gear",
  magazine: "gear",
  champion: "champion",
};

/** Keys handled outside {@link FACET_KEYS}. */
const OTHER_KEYS: ReadonlySet<string> = new Set([
  "is",
  "not",
  "perk",
  "trait",
  "trait1",
  "trait2",
  "origin",
  "origintrait",
  "name",
  "craftable",
]);

/** Lower-case, no spaces or punctuation: "Hand Cannon", "hand-cannon" and "handcannon" meet. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const ELEMENTS = ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand"];
const RARITIES = ["Common", "Uncommon", "Rare", "Legendary", "Exotic"];
const AMMO = ["Primary", "Special", "Heavy"];
/** The catalog's `type` values (manifest `itemTypeDisplayName`). */
const WEAPON_TYPES = [
  "Auto Rifle",
  "Combat Bow",
  "Fusion Rifle",
  "Glaive",
  "Grenade Launcher",
  "Hand Cannon",
  "Linear Fusion Rifle",
  "Machine Gun",
  "Pulse Rifle",
  "Rocket Launcher",
  "Scout Rifle",
  "Shotgun",
  "Sidearm",
  "Sniper Rifle",
  "Submachine Gun",
  "Sword",
  "Trace Rifle",
];
/** Short names the item manager's search takes that the shared aliases don't cover. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(WEAPON_TYPES.map((t) => [squash(t), t])),
  bow: "Combat Bow",
  submachine: "Submachine Gun",
};
const SLOTS: Readonly<Record<string, string>> = {
  kineticslot: "Kinetic",
  energyslot: "Energy",
  energy: "Energy",
  powerslot: "Power",
  power: "Power",
};
const CHAMPIONS: Readonly<Record<string, string>> = {
  barrier: "Barrier",
  antibarrier: "Barrier",
  shieldpiercing: "Barrier",
  overload: "Overload",
  disruption: "Overload",
  unstoppable: "Unstoppable",
  stagger: "Unstoppable",
};

/** A weapon type from its name or a shorthand ("hc", "lfr", "handcannon"), or undefined. */
function weaponTypeOf(raw: string): string | undefined {
  return TYPE_NAMES[squash(expandWeaponQueryAliases(raw))];
}

type FacetValues = Partial<Record<ExcludableFacet, string[]>>;

/**
 * What an `is:` word selects, the same vocabulary as the item manager's search:
 * elements (`is:arc`, `is:light`), rarity, ammo, slot (`is:kineticslot`),
 * champion, and weapon type (`is:handcannon`, `is:hc`).
 */
function isWord(raw: string): FacetValues | undefined {
  const word = squash(raw);
  const element = ELEMENTS.find((e) => squash(e) === word);
  if (element) return { element: [element] };
  if (word === "light") return { element: ["Arc", "Solar", "Void"] };
  if (word === "dark") return { element: ["Stasis", "Strand"] };
  const rarity = RARITIES.find((r) => squash(r) === word);
  if (rarity) return { rarity: [rarity] };
  const ammo = AMMO.find((a) => squash(a) === word);
  if (ammo) return { ammo: [ammo] };
  if (SLOTS[word]) return { slot: [SLOTS[word]] };
  if (CHAMPIONS[word]) return { champion: [CHAMPIONS[word]] };
  if (word === "heavygrenadelauncher") return { type: ["Grenade Launcher"], ammo: ["Heavy"] };
  if (word === "specialgrenadelauncher") return { type: ["Grenade Launcher"], ammo: ["Special"] };
  const type = weaponTypeOf(raw);
  if (type) return { type: [type] };
  return undefined;
}

/**
 * `is:` words that read as something else alone ("light", "power", "stagger"), so
 * typed bare they stay text. The rest match as the Items search's bare keywords do.
 */
const NOT_BARE: ReadonlySet<string> = new Set([
  "light",
  "dark",
  "energy",
  "power",
  "antibarrier",
  "shieldpiercing",
  "disruption",
  "stagger",
  "heavygrenadelauncher",
  "specialgrenadelauncher",
]);

/**
 * The filter a search's whole free text stands for when it's one descriptive word
 * ("arc", "heavy", "smg", "hand cannon"): those weapons lead the results, with
 * name and typo matches after them.
 */
export function bareWordFilters(text: string): WeaponFilters | undefined {
  const word = squash(text);
  if (!word || NOT_BARE.has(word)) return undefined;
  return isWord(text);
}

/**
 * Split a search string into tokens, treating double-quoted runs as a single
 * token (quotes removed) so multi-word values like `perk:"kill clip"` survive.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(input[i]!)) i++;
    if (i >= n) break;
    let token = "";
    while (i < n && !/\s/.test(input[i]!)) {
      const ch = input[i]!;
      if (ch === '"') {
        i++;
        while (i < n && input[i] !== '"') {
          token += input[i];
          i++;
        }
        if (i < n) i++; // closing quote
      } else {
        token += ch;
        i++;
      }
    }
    if (token) tokens.push(token);
  }
  return tokens;
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.some((v) => v.toLowerCase() === value.toLowerCase())) target.push(value);
}

function craftableValue(raw: string): string | null {
  const v = raw.toLowerCase();
  if (v === "yes" || v === "true" || v === "y") return "Yes";
  if (v === "no" || v === "false" || v === "n") return "No";
  return null;
}

/**
 * Parse a raw search string into structured {@link WeaponFilters} plus residual
 * free text. Supports `key:value` filters (`perk:`, `trait:`, `trait1:`, `trait2:`,
 * `origin:`, `element:`, `type:`, `ammo:`, `slot:`, `rarity:`, `frame:`,
 * `source:`, `season:`, `gear:`/`barrel:`/`mag:`, `champion:`, `name:`, `craftable:`)
 * and `is:`/`not:` words (`is:arc`, `is:heavy`, `is:handcannon`, `not:exotic`,
 * `is:adept`, `is:craftable`, … see {@link isWord}). Repeated words of one kind OR
 * together (`is:arc is:solar`); `not:` excludes. Community shorthands (`hc`, `smg`)
 * are alias-expanded for `type:` values. A filter token the parser doesn't know
 * lands in `unknown`; a bare `key:` still being typed is ignored; other tokens are `text`.
 */
export function parseWeaponQuery(input: string): ParsedWeaponQuery {
  const filters: WeaponFilters = {};
  const freeText: string[] = [];
  const unknown: string[] = [];

  const addFacet = (key: (typeof ARRAY_FACET_KEYS)[number], value: string) => {
    const list = (filters[key] ??= []);
    pushUnique(list, value);
  };
  const addExcluded = (key: ExcludableFacet, value: string) => {
    const exclude = (filters.exclude ??= {});
    pushUnique((exclude[key] ??= []), value);
  };

  for (const token of tokenize(input)) {
    const colon = token.indexOf(":");
    if (colon <= 0) {
      freeText.push(token);
      continue;
    }

    const key = token.slice(0, colon).toLowerCase();
    const rawValue = token.slice(colon + 1);
    const known = key in FACET_KEYS || OTHER_KEYS.has(key);

    if (!rawValue) {
      // `is:` mid-typing narrows nothing yet; "Property:" from a pasted perk name is text.
      if (!known) freeText.push(token);
      continue;
    }
    if (!known) {
      unknown.push(token);
      continue;
    }

    if (key === "is" || key === "not") {
      const flag = squash(rawValue);
      const on = key === "is";
      if (flag === "adept") {
        filters.adept = on;
        continue;
      }
      if (flag === "craftable" || flag === "craftble") {
        addFacet("craftable", on ? "Yes" : "No");
        continue;
      }
      const values = isWord(rawValue);
      const facets = values ? (Object.keys(values) as ExcludableFacet[]) : [];
      // not:heavygrenadelauncher would need NOT (A AND B), which per-facet exclusion can't say.
      if (!values || (!on && facets.length > 1)) {
        unknown.push(token);
        continue;
      }
      for (const facet of facets) {
        for (const value of values[facet]!) {
          if (on) addFacet(facet, value);
          else addExcluded(facet, value);
        }
      }
      continue;
    }

    if (key === "perk") {
      addFacet("perks", rawValue);
      continue;
    }
    if (key === "trait") {
      addFacet("trait", rawValue);
      continue;
    }
    if (key === "trait1") {
      addFacet("trait1", rawValue);
      continue;
    }
    if (key === "trait2") {
      addFacet("trait2", rawValue);
      continue;
    }
    if (key === "origin" || key === "origintrait") {
      addFacet("originTrait", rawValue);
      continue;
    }
    if (key === "name") {
      addFacet("name", rawValue);
      continue;
    }
    if (key === "craftable") {
      const value = craftableValue(rawValue);
      if (value) addFacet("craftable", value);
      else unknown.push(token);
      continue;
    }

    const facet = FACET_KEYS[key]!;
    if (facet === "type") addFacet(facet, weaponTypeOf(rawValue) ?? rawValue);
    else if (facet === "champion") addFacet(facet, CHAMPIONS[squash(rawValue)] ?? rawValue);
    else if (facet === "slot") addFacet(facet, SLOTS[squash(rawValue)] ?? rawValue);
    else addFacet(facet, rawValue);
  }

  return { filters, text: freeText.join(" "), unknown };
}

/** How to execute a free-form query: keyword filters plus the text to fuzzy-search. */
export interface WeaponTextSearchPlan {
  filters: WeaponFilters;
  /**
   * The free text to run name/fuzzy search on. Under `MIN_WEAPON_TEXT_QUERY_LENGTH`
   * it searches nothing: the caller filters the full catalog and lets `filters` narrow it.
   * Filter tokens never come back here, so `is:arc` can't fuzzy-match "Whisper".
   */
  searchText: string;
  /** Filter tokens the parser doesn't know; the caller should show no results. */
  unknown: string[];
}

/** Parse `input` once into the filters, the free text to search, and any unknown filters. */
export function planWeaponTextSearch(input: string): WeaponTextSearchPlan {
  const { filters, text, unknown } = parseWeaponQuery(input);
  return { filters, searchText: text.trim(), unknown };
}

function mergeFacetArray(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a?.length) return b?.length ? [...b] : a;
  if (!b?.length) return [...a];
  const seen = new Set(a.map((v) => v.toLowerCase()));
  const merged = [...a];
  for (const value of b) {
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      merged.push(value);
    }
  }
  return merged;
}

/**
 * Combine two filter sets (e.g. chip-derived `base` + keyword-parsed `extra`),
 * OR-merging each facet array and letting `extra`'s flags extend `base`. `extra`
 * wins for the single-valued `adept` flag when it sets one.
 */
export function mergeWeaponFilters(base: WeaponFilters, extra: WeaponFilters): WeaponFilters {
  if (Object.keys(extra).length === 0) return base;
  const out: WeaponFilters = { ...base };

  for (const key of ARRAY_FACET_KEYS) {
    const merged = mergeFacetArray(base[key], extra[key]);
    if (merged) out[key] = merged;
  }

  if (extra.customPerkGroups?.length) {
    out.customPerkGroups = [...(base.customPerkGroups ?? []), ...extra.customPerkGroups];
  }
  if (extra.exclude) {
    const exclude: NonNullable<WeaponFilters["exclude"]> = { ...base.exclude };
    for (const key of Object.keys(extra.exclude) as ExcludableFacet[]) {
      const merged = mergeFacetArray(exclude[key], extra.exclude[key]);
      if (merged) exclude[key] = merged;
    }
    out.exclude = exclude;
  }
  if (extra.adept != null) out.adept = extra.adept;
  if (extra.trait1DamagePerks != null) out.trait1DamagePerks = extra.trait1DamagePerks;
  if (extra.trait2DamagePerks != null) out.trait2DamagePerks = extra.trait2DamagePerks;
  if (extra.perkCombo) out.perkCombo = mergeFacetArray(base.perkCombo, extra.perkCombo);

  return out;
}
