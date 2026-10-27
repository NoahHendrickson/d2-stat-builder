"use client";

import { useMemo } from "react";
import type { FacetFilters } from "@/lib/armor-table/filters";
import type { FilterOption } from "@/lib/armor-table/pinned";
import {
  ARMOR_VERSION_OPTIONS,
  CLASS_OPTIONS,
  FACETS,
  STAT_FILTER_OPTIONS,
  TUNING_FILTER_OPTIONS,
  type FacetKey,
  type FacetValue,
} from "@/lib/armor-table/facets";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";
import { useSetMenuList } from "@/components/set-menu";

/** A facet's menu, options and pins bound: what every filter surface renders. */
export interface FacetSpec<V> {
  label: string;
  allLabel: string;
  options: FilterOption<V>[];
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
}

export type FacetSpecs = { [K in FacetKey]: FacetSpec<FacetValue<K>> };

/** The armor table's filters, for any surface that edits them (toolbar, cascade, headers). */
export interface FacetFilterState {
  specs: FacetSpecs;
  facets: FacetFilters;
  onFacetChange: <K extends FacetKey>(key: K, value: FacetFilters[K]) => void;
}

/**
 * Binds each facet's options and pins. Sets take the shared set list (account pins);
 * archetype pins are the table's own.
 */
export function useFacetSpecs({
  setOptions,
  archetypeOptions,
  pinnedArchetypes,
  onTogglePinnedArchetype,
}: {
  setOptions: FilterOption<number>[];
  archetypeOptions: FilterOption<string>[];
  pinnedArchetypes: string[];
  onTogglePinnedArchetype: (name: string) => void;
}): FacetSpecs {
  const { pinned: pinnedSets, onTogglePin: togglePinnedSet } = useSetMenuList();
  return useMemo(
    () => ({
      classes: { ...FACETS.classes, options: CLASS_OPTIONS },
      armorVersions: { ...FACETS.armorVersions, options: ARMOR_VERSION_OPTIONS },
      setHashes: {
        ...FACETS.setHashes,
        options: setOptions,
        searchable: true,
        pinnable: true,
        pinned: pinnedSets,
        onTogglePin: togglePinnedSet,
      },
      archetypes: {
        ...FACETS.archetypes,
        options: archetypeOptions,
        searchable: true,
        pinnable: true,
        pinned: pinnedArchetypes,
        onTogglePin: onTogglePinnedArchetype,
      },
      tunings: { ...FACETS.tunings, options: TUNING_FILTER_OPTIONS },
      tertiaries: { ...FACETS.tertiaries, options: STAT_FILTER_OPTIONS },
    }),
    [
      setOptions,
      pinnedSets,
      togglePinnedSet,
      archetypeOptions,
      pinnedArchetypes,
      onTogglePinnedArchetype,
    ],
  );
}

/** One facet's filter menu: a toolbar dropdown, or a column header's icon button. */
export function FacetFilterMenu<K extends FacetKey>({
  facet,
  filters,
  variant,
  hovered,
}: {
  facet: K;
  filters: FacetFilterState;
  variant?: "field" | "icon";
  /** Icon variant: the pointer is somewhere in this column. */
  hovered?: boolean;
}) {
  const spec = filters.specs[facet] as FacetSpec<FacetValue<K>>;
  return (
    <FilterMultiselect<FacetValue<K>>
      {...spec}
      value={filters.facets[facet] as FacetValue<K>[]}
      onChange={(v) => filters.onFacetChange(facet, v as FacetFilters[K])}
      variant={variant}
      hovered={hovered}
    />
  );
}
