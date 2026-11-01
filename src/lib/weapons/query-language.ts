import { WEAPON_NAME_ALIASES } from "./aliases";
import {
  AMMO_WORDS,
  CHAMPION_SYNONYMS,
  CHAMPION_WORDS,
  ELEMENT_SIDES,
  GRENADE_LAUNCHER_AMMO_WORDS,
  RARITY_WORDS,
  WEAPON_SLOT_ALIASES,
  WEAPON_SLOT_WORDS,
} from "@/lib/search-vocabulary";
import type { ExcludableFacet, WeaponFilters } from "./search";

/** A filter token that selects nothing, and why: shown in place of results. */
export interface UnknownFilter {
  token: string;
  /** Follows the token: "isn't a search filter", "isn't a weapon type", … */
  reason: string;
}

/** Result of parsing a raw search box string into structured filters + leftover free text. */
export interface ParsedWeaponQuery {
  filters: WeaponFilters;
  /** Non-keyword terms, rejoined and trimmed: feed this to name/fuzzy search. */
  text: string;
  /**
   * When `text` is one descriptive word ("arc", "heavy", "smg", "hand cannon"), the
   * weapons it describes. They lead the results, with name and typo matches after them.
   */
  keyword?: WeaponFilters;
  /**
   * Filter tokens that mean nothing (`is:arcc`, `elemnt:solar`, `type:blaster`). They
   * match nothing rather than falling through to fuzzy text, which would match junk.
   */
  unknown: UnknownFilter[];
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
type ArrayFacetKey = (typeof ARRAY_FACET_KEYS)[number];

/** `key:` tokens that add their value to a facet. `is:`, `not:` and `craftable:` are parsed apart. */
const FACET_KEYS: ReadonlyMap<string, Exclude<ArrayFacetKey, "craftable">> = new Map([
  ["element", "element"],
  ["damage", "element"],
  ["type", "type"],
  ["weapon", "type"],
  ["ammo", "ammo"],
  ["slot", "slot"],
  ["rarity", "rarity"],
  ["tier", "rarity"],
  ["frame", "frame"],
  ["archetype", "frame"],
  ["source", "source"],
  ["activity", "source"],
  ["season", "season"],
  ["gear", "gear"],
  ["barrel", "gear"],
  ["mag", "gear"],
  ["magazine", "gear"],
  ["champion", "champion"],
  ["perk", "perks"],
  ["trait", "trait"],
  ["trait1", "trait1"],
  ["trait2", "trait2"],
  ["origin", "originTrait"],
  ["origintrait", "originTrait"],
  ["name", "name"],
]);

/** How the unknown-value message names each closed facet ("isn't a weapon type"). */
const VALUE_NAMES: Record<ExcludableFacet, string> = {
  element: "an element",
  type: "a weapon type",
  ammo: "an ammo type",
  rarity: "a rarity",
  slot: "a weapon slot",
  champion: "a champion",
};
const isClosedFacet = (facet: ArrayFacetKey): facet is ExcludableFacet => facet in VALUE_NAMES;

const NOT_A_FILTER = "isn't a search filter";

/** Lower-case, no spaces or punctuation: "Hand Cannon", "hand-cannon" and "handcannon" meet. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

type FacetValues = Partial<Record<ExcludableFacet, string[]>>;

/** What an `is:` word selects, and whether typed alone it also lists those weapons first. */
interface IsWord {
  facets: FacetValues;
  bare: boolean;
}

/**
 * The words a weapon search understands, from the catalog's own weapon types and
 * elements (a type Bungie adds works without a code change) plus the shared vocabulary
 * in search-vocabulary.ts. Build once per catalog.
 */
export interface WeaponQueryVocabulary {
  /** Squashed `is:`/`not:` word → what it selects. */
  isWords: ReadonlyMap<string, IsWord>;
  /** Per closed facet, squashed `key:` value → the catalog value it names. */
  values: Readonly<Record<ExcludableFacet, ReadonlyMap<string, string>>>;
}

/** Type shorthands not in WEAPON_NAME_ALIASES, as squashed type names. */
const TYPE_SHORTHANDS: Readonly<Record<string, string>> = {
  bow: "combatbow",
  submachine: "submachinegun",
};

export function weaponQueryVocabulary({
  types,
  elements,
}: {
  types: readonly string[];
  elements: readonly string[];
}): WeaponQueryVocabulary {
  const named = (names: Iterable<string>) => new Map([...names].map((n) => [squash(n), n] as const));
  const words = (table: Readonly<Record<string, string>>) => new Map(Object.entries(table));

  const elementValues = named(elements);
  const typeValues = named(types);
  for (const [short, full] of [...Object.entries(WEAPON_NAME_ALIASES), ...Object.entries(TYPE_SHORTHANDS)]) {
    const type = typeValues.get(squash(full));
    if (type && !typeValues.has(squash(short))) typeValues.set(squash(short), type);
  }
  // Grenade launchers by ammo: a type value that also checks ammo (see FACET_VALUES).
  for (const [word, ammo] of Object.entries(GRENADE_LAUNCHER_AMMO_WORDS)) {
    const launcher = typeValues.get("grenadelauncher");
    if (launcher) typeValues.set(word, `${ammo} ${launcher}`);
  }
  const slotValues = words({ ...WEAPON_SLOT_WORDS, ...WEAPON_SLOT_ALIASES });
  for (const slot of Object.values(WEAPON_SLOT_WORDS)) slotValues.set(squash(slot), slot);

  const values: WeaponQueryVocabulary["values"] = {
    element: elementValues,
    type: typeValues,
    ammo: words(AMMO_WORDS),
    rarity: words(RARITY_WORDS),
    slot: slotValues,
    champion: words(CHAMPION_WORDS),
  };

  // Every `is:` word, and whether it also works alone. Words that read as something
  // else on their own ("light", "power", "stagger") or name two facets stay text.
  const isWords = new Map<string, IsWord>();
  const add = (word: string, facets: FacetValues, bare: boolean) => {
    if (!isWords.has(word)) isWords.set(word, { facets, bare });
  };
  for (const [word, element] of elementValues) add(word, { element: [element] }, true);
  for (const [side, sideElements] of Object.entries(ELEMENT_SIDES)) {
    const present = sideElements.flatMap((e) => elementValues.get(e) ?? []);
    if (present.length) add(side, { element: present }, false);
  }
  for (const [word, rarity] of Object.entries(RARITY_WORDS)) add(word, { rarity: [rarity] }, true);
  for (const [word, ammo] of Object.entries(AMMO_WORDS)) add(word, { ammo: [ammo] }, true);
  for (const [word, slot] of Object.entries(WEAPON_SLOT_WORDS)) add(word, { slot: [slot] }, true);
  for (const [word, slot] of Object.entries(WEAPON_SLOT_ALIASES)) add(word, { slot: [slot] }, false);
  for (const [word, champion] of Object.entries(CHAMPION_WORDS)) {
    add(word, { champion: [champion] }, !CHAMPION_SYNONYMS.has(word));
  }
  for (const [word, type] of typeValues) add(word, { type: [type] }, !Object.hasOwn(GRENADE_LAUNCHER_AMMO_WORDS, word));

  return { isWords, values };
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
 * free text. Supports `key:value` filters (see {@link FACET_KEYS}, plus `craftable:`)
 * and `is:`/`not:` words (`is:arc`, `is:heavy`, `is:handcannon`, `not:exotic`,
 * `is:adept`, `is:craftable`, … see {@link weaponQueryVocabulary}). Repeated words of
 * one kind OR together (`is:arc is:solar`); `not:` excludes. Element, type, ammo,
 * rarity, slot and champion values must name one (`type:hc` works, `type:blaster`
 * doesn't). A filter that means nothing lands in `unknown`; a bare `key:` still being
 * typed is ignored; other tokens, including a quoted perk name with a colon in it
 * ("Property: Undecidable"), are `text`.
 */
export function parseWeaponQuery(input: string, vocabulary: WeaponQueryVocabulary): ParsedWeaponQuery {
  const filters: WeaponFilters = {};
  const freeText: string[] = [];
  const unknown: UnknownFilter[] = [];

  const addFacet = (key: ArrayFacetKey, value: string) => {
    pushUnique((filters[key] ??= []), value);
  };
  const addExcluded = (key: ExcludableFacet, value: string) => {
    const exclude = (filters.exclude ??= {});
    pushUnique((exclude[key] ??= []), value);
  };

  for (const token of tokenize(input)) {
    const colon = token.indexOf(":");
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
    const rawValue = token.slice(colon + 1);
    // Keys never have spaces, and values never start with one: that's a perk name.
    if (!key || /\s/.test(key) || /^\s/.test(rawValue)) {
      freeText.push(token);
      continue;
    }

    const facet = FACET_KEYS.get(key);
    if (!facet && key !== "is" && key !== "not" && key !== "craftable") {
      // "Property:" on its own is the start of a pasted perk name, not a filter.
      if (rawValue) unknown.push({ token, reason: NOT_A_FILTER });
      else freeText.push(token);
      continue;
    }
    // `is:` mid-typing narrows nothing yet.
    if (!rawValue) continue;

    if (facet) {
      if (!isClosedFacet(facet)) {
        addFacet(facet, rawValue);
        continue;
      }
      const value = vocabulary.values[facet].get(squash(rawValue));
      if (value) addFacet(facet, value);
      else unknown.push({ token, reason: `isn't ${VALUE_NAMES[facet]}` });
      continue;
    }

    if (key === "craftable") {
      const value = craftableValue(rawValue);
      if (value) addFacet("craftable", value);
      else unknown.push({ token, reason: "takes yes or no" });
      continue;
    }

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
    const word = vocabulary.isWords.get(flag);
    if (!word) {
      unknown.push({ token, reason: NOT_A_FILTER });
      continue;
    }
    for (const [kind, kindValues] of Object.entries(word.facets) as [ExcludableFacet, string[]][]) {
      for (const value of kindValues) {
        if (on) addFacet(kind, value);
        else addExcluded(kind, value);
      }
    }
  }

  const text = freeText.join(" ").trim();
  const bare = vocabulary.isWords.get(squash(text));
  return { filters, text, unknown, ...(bare?.bare ? { keyword: bare.facets } : {}) };
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
