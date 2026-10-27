// The armor table's filter facets, described once: the toolbar menus, its cascade
// menu and the column header filters all render a facet from this.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
} from "../armory/stats";
import type { ArmorVersion, FacetFilters, TuningFilter } from "./filters";
import type { FilterOption } from "./pinned";

export type FacetKey = keyof FacetFilters;
/** One option value of a facet (a class number, an archetype name…). */
export type FacetValue<K extends FacetKey> = FacetFilters[K][number];

export const CLASS_OPTIONS: FilterOption<number>[] = [0, 1, 2].map((c) => ({
  value: c,
  label: CLASS_NAMES[c],
}));

export const ARMOR_VERSION_OPTIONS: FilterOption<ArmorVersion>[] = [
  { value: "3.0", label: "Armor 3.0" },
  { value: "2.0", label: "Armor 2.0" },
];

export const STAT_FILTER_OPTIONS: FilterOption<number>[] =
  STAT_DISPLAY_ORDER.map((key) => ({
    value: STAT_ORDER.indexOf(key),
    label: STAT_LABELS[key],
  }));

export const TUNING_FILTER_OPTIONS: FilterOption<TuningFilter>[] = [
  ...STAT_FILTER_OPTIONS,
  { value: "none", label: "Not tunable" },
];

/** How each facet's menu reads, in menu order. */
export const FACETS: Record<FacetKey, { label: string; allLabel: string }> = {
  classes: { label: "Class", allLabel: "All classes" },
  armorVersions: { label: "Armor", allLabel: "All armor" },
  setHashes: { label: "Set", allLabel: "All sets" },
  archetypes: { label: "Archetype", allLabel: "All archetypes" },
  tunings: { label: "Tuning", allLabel: "Any tuning" },
  tertiaries: { label: "Tertiary", allLabel: "Any tertiary" },
};

export const FACET_KEYS = Object.keys(FACETS) as FacetKey[];
