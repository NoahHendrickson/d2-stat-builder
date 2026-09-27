import { expandWeaponQueryAliases } from "./aliases";
import { MIN_WEAPON_TEXT_QUERY_LENGTH, type WeaponFilters } from "./search";

/** Result of parsing a raw search box string into structured filters + leftover free text. */
export interface ParsedWeaponQuery {
  filters: WeaponFilters;
  /** Non-keyword terms, rejoined — feed this to name/fuzzy search. */
  text: string;
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
  "perks",
  "craftable",
  "name",
] as const satisfies readonly (keyof WeaponFilters)[];

/** `key:` tokens that map straight onto an OR-within facet array. */
const FACET_KEYS: Readonly<
  Record<string, "element" | "type" | "ammo" | "slot" | "rarity" | "frame" | "source" | "season">
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
};

const RARITY_WORDS: ReadonlySet<string> = new Set([
  "common",
  "uncommon",
  "rare",
  "legendary",
  "exotic",
]);

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
 * `source:`, `season:`, `name:`, `craftable:`) and `is:` flags (`is:adept`, `is:craftable`,
 * `is:exotic`, …). Community shorthands (`hc`, `smg`) are alias-expanded for
 * `type:` values. Unknown tokens fall through to `text`.
 */
export function parseWeaponQuery(input: string): ParsedWeaponQuery {
  const filters: WeaponFilters = {};
  const freeText: string[] = [];

  const addFacet = (key: (typeof ARRAY_FACET_KEYS)[number], value: string) => {
    const list = (filters[key] ??= []);
    pushUnique(list, value);
  };

  for (const token of tokenize(input)) {
    const colon = token.indexOf(":");
    if (colon <= 0 || colon === token.length - 1) {
      freeText.push(token);
      continue;
    }

    const key = token.slice(0, colon).toLowerCase();
    const rawValue = token.slice(colon + 1);

    if (key === "is" || key === "not") {
      const flag = rawValue.toLowerCase();
      const on = key === "is";
      if (flag === "adept") {
        filters.adept = on;
      } else if (flag === "craftable" || flag === "craftble") {
        addFacet("craftable", on ? "Yes" : "No");
      } else if (RARITY_WORDS.has(flag) && on) {
        addFacet("rarity", flag);
      } else {
        freeText.push(token);
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
      else freeText.push(token);
      continue;
    }

    const facet = FACET_KEYS[key];
    if (facet) {
      addFacet(facet, facet === "type" ? expandWeaponQueryAliases(rawValue) : rawValue);
      continue;
    }

    // Unknown key — keep the whole token as free text.
    freeText.push(token);
  }

  return { filters, text: freeText.join(" ") };
}

/** How to execute a free-form query: keyword filters plus the text to fuzzy-search. */
export interface WeaponTextSearchPlan {
  filters: WeaponFilters;
  /**
   * The free text to run name/fuzzy search on. Empty string means "no usable
   * text" — the caller should search the full catalog and let `filters` narrow it.
   */
  searchText: string;
}

/**
 * Parse `input` once and decide the text to search:
 * - enough free text → search that text (keywords stripped out into `filters`);
 * - only keyword filters → empty `searchText` (filter the full catalog);
 * - otherwise → fall back to the raw input as plain text.
 *
 * Centralizes the keyword-only / text / both branching so call sites don't reparse.
 */
export function planWeaponTextSearch(input: string): WeaponTextSearchPlan {
  const { filters, text } = parseWeaponQuery(input);
  const trimmed = text.trim();
  if (trimmed.length >= MIN_WEAPON_TEXT_QUERY_LENGTH) {
    return { filters, searchText: trimmed };
  }
  if (Object.keys(filters).length > 0) {
    return { filters, searchText: "" };
  }
  return { filters, searchText: input.trim() };
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
  if (extra.adept != null) out.adept = extra.adept;
  if (extra.trait1DamagePerks != null) out.trait1DamagePerks = extra.trait1DamagePerks;
  if (extra.trait2DamagePerks != null) out.trait2DamagePerks = extra.trait2DamagePerks;
  if (extra.perkCombo) out.perkCombo = mergeFacetArray(base.perkCombo, extra.perkCombo);

  return out;
}
