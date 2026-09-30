import { expandWeaponQueryAliases } from "./aliases";
import { matchRank } from "./rank";
import type { FacetOption } from "./search";
import { FILTERS, type WeaponSearchState } from "./search-state";

/** A filter family the search box can suggest values from, keyed by its URL param. */
export interface FilterCategory {
  param: string;
  label: string;
  /** Most values one search keeps; adding past it drops the oldest. */
  max?: number;
  /** Worst `matchRank` inline suggestions accept (default 2, word-start). */
  maxRank?: number;
  /** Frames are full of common words; only suggest ones the query starts. */
  prefixOnly?: boolean;
  /** Two picks build one chip ("A + B"); a pick after a full pair starts a new one. */
  pair?: boolean;
  /** Takes a typed whole number as a lower bound ("Ammo gen > 50") instead of listed values. */
  numeric?: boolean;
  /** Other names for the category: typed before a number ("ammo generation 50"), or to browse it ("archetype"). */
  aliases?: string[];
}

/** One pickable value. `param` can differ from its category's (Trait 1 → damage perks). */
export interface FilterValue {
  param: string;
  value: string;
  label: string;
  count?: number;
  /** Chip text when "Category: label" reads badly. */
  chip?: string;
}

export interface FilterSuggestion {
  category: FilterCategory;
  value: FilterValue;
}

export interface FilterChip {
  param: string;
  value: string;
  text: string;
}

const LABELS: Record<string, string> = Object.fromEntries(FILTERS);

/**
 * Order breaks ranking ties, as in noeyarmory: perk columns first, then facets.
 * Trait (either column) leads since it's the usual perk search.
 */
export const FILTER_CATEGORIES: readonly FilterCategory[] = [
  { param: "trait", label: LABELS.trait },
  { param: "trait1", label: LABELS.trait1 },
  { param: "trait2", label: LABELS.trait2 },
  { param: "perkCombo", label: LABELS.perkCombo, pair: true },
  { param: "originTrait", label: LABELS.originTrait },
  { param: "gear", label: LABELS.gear, aliases: ["barrel", "magazine"] },
  { param: "champion", label: LABELS.champion, aliases: ["anti-champion"] },
  { param: "type", label: LABELS.type },
  { param: "element", label: LABELS.element },
  { param: "ammo", label: LABELS.ammo },
  {
    param: "ammoGen",
    label: "Ammo gen",
    numeric: true,
    max: 1,
    aliases: ["ammo generation"],
  },
  { param: "slot", label: LABELS.slot },
  { param: "source", label: LABELS.source, maxRank: 3 },
  { param: "season", label: LABELS.season },
  { param: "frame", label: LABELS.frame, prefixOnly: true, aliases: ["archetype"] },
  { param: "rarity", label: LABELS.rarity },
  { param: "craftable", label: LABELS.craftable, max: 1 },
  { param: "adept", label: "Adept", max: 1 },
];

const PAIR_PARAMS = new Set(
  FILTER_CATEGORIES.filter((c) => c.pair).map((c) => c.param),
);

/** The first half of a pair filter still waiting for its second pick. */
export function pendingPairValue(
  params: URLSearchParams,
  param: string,
): string | undefined {
  if (!PAIR_PARAMS.has(param)) return undefined;
  const values = params.getAll(param);
  return values.length === 1 ? values[0] : undefined;
}

export interface FilterIndexEntry {
  category: FilterCategory;
  values: FilterValue[];
}

/** Every category with its values, built once per catalog. */
export function buildFilterIndex(
  facets: Record<string, FacetOption[]>,
): FilterIndexEntry[] {
  return FILTER_CATEGORIES.map((category) => {
    const values: FilterValue[] = (facets[category.param] ?? []).map(
      ({ value, count }) => ({
        param: category.param,
        value,
        label: value,
        count: count || undefined,
      }),
    );
    if (category.param === "trait1" || category.param === "trait2") {
      values.unshift({
        param: `${category.param}DamagePerks`,
        value: "true",
        label: "Damage perks",
        chip: `${category.label}: damage perks`,
      });
    }
    if (category.param === "adept") {
      values.push(
        { param: "adept", value: "true", label: "Adept", chip: "Adept" },
        { param: "adept", value: "false", label: "Standard", chip: "Standard" },
      );
    }
    return { category, values };
  });
}

/** A typed bound ("50", "> 50") as a whole number, or null. */
function parseBound(text: string): number | null {
  const match = text.trim().match(/^>?\s*(\d{1,3})$/);
  return match ? Number(match[1]) : null;
}

function boundValue(category: FilterCategory, bound: number): FilterValue {
  return {
    param: category.param,
    value: String(bound),
    label: `> ${bound}`,
    chip: `${category.label} > ${bound}`,
  };
}

/** "ammo gen 50" / "ammo generation > 50": a numeric category's name, then a bound. */
function suggestBounds(
  index: readonly FilterIndexEntry[],
  query: string,
  params: URLSearchParams,
): FilterSuggestion[] {
  const match = query.match(/^(.*?[a-z])\s*(>?\s*\d{1,3})$/i);
  if (!match) return [];
  const name = match[1].replace(/\s+/g, "").toLowerCase();
  const bound = parseBound(match[2]);
  if (name.length < 3 || bound == null) return [];
  return index.flatMap(({ category }) => {
    if (!category.numeric) return [];
    const names = [category.label, ...(category.aliases ?? [])].map((n) =>
      n.replace(/\s+/g, "").toLowerCase(),
    );
    const value = boundValue(category, bound);
    return names.some((n) => n.startsWith(name)) && !isApplied(params, value)
      ? [{ category, value }]
      : [];
  });
}

function isApplied(params: URLSearchParams, value: FilterValue): boolean {
  return params.getAll(value.param).includes(value.value);
}

/** Best rank of a label against the query or its shorthand expansion ("hc"). */
function rankLabel(label: string, query: string, expanded: string) {
  const direct = matchRank(label, query);
  if (expanded === query.toLowerCase()) return direct;
  const alias = matchRank(label, expanded);
  if (direct == null) return alias;
  return alias == null ? direct : Math.min(direct, alias);
}

/** "Category: value" rows for typed text, strongest matches first. */
export function suggestFilters(
  index: readonly FilterIndexEntry[],
  query: string,
  params: URLSearchParams,
  limit = 12,
): FilterSuggestion[] {
  const q = query.trim();
  if (!q) return [];
  const bounds = suggestBounds(index, q, params);
  const lower = q.toLowerCase();
  const expanded = expandWeaponQueryAliases(lower);
  const scored: {
    suggestion: FilterSuggestion;
    rank: number;
    priority: number;
  }[] = [];
  index.forEach(({ category, values }, priority) => {
    for (const value of values) {
      if (isApplied(params, value)) continue;
      const rank = rankLabel(value.label, q, expanded);
      if (rank == null || rank > (category.maxRank ?? 2)) continue;
      if (category.prefixOnly && !value.label.toLowerCase().startsWith(lower))
        continue;
      scored.push({ suggestion: { category, value }, rank, priority });
    }
  });
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.priority - b.priority ||
      (b.suggestion.value.count ?? 0) - (a.suggestion.value.count ?? 0) ||
      a.suggestion.value.label.localeCompare(b.suggestion.value.label),
  );
  // A typed bound is exactly what was asked for, so it leads.
  return [
    ...bounds,
    ...scored.slice(0, limit - bounds.length).map((entry) => entry.suggestion),
  ];
}

/** Categories to browse: all of them when empty, else those whose name matches. */
export function matchingCategories(
  index: readonly FilterIndexEntry[],
  query: string,
): FilterIndexEntry[] {
  const q = query.trim();
  if (!q) return [...index];
  return index.filter(({ category }) =>
    [category.label, ...(category.aliases ?? [])].some((name) => {
      const rank = matchRank(name, q);
      return rank != null && rank <= 2;
    }),
  );
}

/** One category's unapplied values narrowed by typed text, capped for rendering. */
export function categoryValues(
  entry: FilterIndexEntry,
  text: string,
  params: URLSearchParams,
  cap = 100,
): { values: FilterValue[]; hidden: number } {
  if (entry.category.numeric) {
    const bound = parseBound(text);
    const value = bound == null ? null : boundValue(entry.category, bound);
    return {
      values: value && !isApplied(params, value) ? [value] : [],
      hidden: 0,
    };
  }
  const q = text.trim();
  let values = entry.values.filter((value) => !isApplied(params, value));
  if (q) {
    const lower = q.toLowerCase();
    const expanded = expandWeaponQueryAliases(lower);
    values = values
      .map((value) => ({ value, rank: rankLabel(value.label, q, expanded) }))
      .filter(
        (row): row is { value: FilterValue; rank: number } => row.rank != null,
      )
      .sort((a, b) => a.rank - b.rank)
      .map((row) => row.value);
  }
  return {
    values: values.slice(0, cap),
    hidden: Math.max(0, values.length - cap),
  };
}

/** Params with the value added (newest kept when the category is capped) and free text cleared. */
export function withFilter(
  params: URLSearchParams,
  value: FilterValue,
  { max, pair }: Pick<FilterCategory, "max" | "pair"> = {},
): URLSearchParams {
  const next = new URLSearchParams(params);
  const kept = next.getAll(value.param).filter((v) => v !== value.value);
  let values =
    pair && kept.length >= 2 ? [value.value] : [...kept, value.value];
  if (max) values = values.slice(-max);
  next.delete(value.param);
  for (const v of values) next.append(value.param, v);
  next.delete("q");
  return next;
}

export function withoutFilter(
  params: URLSearchParams,
  chip: Pick<FilterChip, "param" | "value">,
): URLSearchParams {
  const next = new URLSearchParams(params);
  // A pair is one chip, so removing it drops both halves.
  const values = PAIR_PARAMS.has(chip.param)
    ? []
    : next.getAll(chip.param).filter((v) => v !== chip.value);
  next.delete(chip.param);
  for (const v of values) next.append(chip.param, v);
  return next;
}

/**
 * The applied filters as removable chips. With the URL params they follow the
 * order filters were added (each add re-appends its param), so Backspace takes
 * the newest; otherwise category order.
 */
export function activeFilterChips(
  state: WeaponSearchState,
  params?: URLSearchParams,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const { filters } = state;
  for (const { param, label, pair } of FILTER_CATEGORIES) {
    if (param === "trait1" || param === "trait2") {
      if (filters[`${param}DamagePerks`]) {
        chips.push({
          param: `${param}DamagePerks`,
          value: "true",
          text: `${label}: damage perks`,
        });
      }
    }
    if (param === "ammoGen") {
      if (filters.ammoGenAbove != null) {
        chips.push({
          param,
          value: String(filters.ammoGenAbove),
          text: `${label} > ${filters.ammoGenAbove}`,
        });
      }
      continue;
    }
    if (param === "adept") {
      if (filters.adept != null) {
        chips.push({
          param,
          value: String(filters.adept),
          text: filters.adept ? "Adept" : "Standard",
        });
      }
      continue;
    }
    const values = filters[param as (typeof FILTERS)[number][0]] ?? [];
    if (pair) {
      if (values.length)
        chips.push({
          param,
          value: values.join(" + "),
          text: `${label}: ${values.join(" + ")}${values.length === 1 ? " + …" : ""}`,
        });
      continue;
    }
    for (const value of values)
      chips.push({ param, value, text: `${label}: ${value}` });
  }
  for (const group of filters.customPerkGroups ?? []) {
    chips.push({
      param: "group",
      value: JSON.stringify(group),
      text: `Any: ${group.join(" / ")}`,
    });
  }
  if (!params) return chips;
  const order = [...new Set(params.keys())];
  const at = (param: string) => {
    const i = order.indexOf(param);
    return i < 0 ? order.length : i;
  };
  return chips.sort((a, b) => at(a.param) - at(b.param));
}
