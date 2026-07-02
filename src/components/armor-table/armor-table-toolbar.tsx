"use client";

import type { RefObject } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { FilterOption } from "@/lib/armor-table/pinned";
import type { ArmorVersion, FacetFilters, TuningFilter } from "@/lib/armor-table/filters";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { Input } from "@/components/ui/input";
import { FilterCascadeMenu } from "@/components/armor-table/filter-cascade-menu";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";

const CLASS_OPTIONS: FilterOption<number>[] = [0, 1, 2].map((c) => ({
  value: c,
  label: CLASS_NAMES[c],
}));

const ARMOR_VERSION_OPTIONS: FilterOption<ArmorVersion>[] = [
  { value: "3.0", label: "Armor 3.0" },
  { value: "2.0", label: "Armor 2.0" },
];

const OVERFLOW_FACETS = ["archetypes", "tunings", "tertiaries"] as const;

/**
 * The table's filter bar: search, the six multiselect filters, and the
 * result count. Lives in the table frame's header row, above the
 * sticky column headers.
 */
export function ArmorTableToolbar({
  search,
  onSearchChange,
  searchRef,
  facets,
  onFacetChange,
  setOptions,
  archetypeOptions,
  statOptions,
  pinnedSets,
  pinnedArchetypes,
  onTogglePinnedSet,
  onTogglePinnedArchetype,
  filteredCount,
  filtersActive,
  onClearFilters,
}: {
  search: string;
  onSearchChange: (search: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  facets: FacetFilters;
  onFacetChange: <K extends keyof FacetFilters>(
    key: K,
    value: FacetFilters[K],
  ) => void;
  setOptions: FilterOption<number>[];
  archetypeOptions: FilterOption<string>[];
  statOptions: FilterOption<number>[];
  pinnedSets: number[];
  pinnedArchetypes: string[];
  onTogglePinnedSet: (hash: number) => void;
  onTogglePinnedArchetype: (name: string) => void;
  filteredCount: number;
  filtersActive: boolean;
  onClearFilters: () => void;
}) {
  const cascadeMenuProps = {
    facets,
    onFacetChange,
    setOptions,
    archetypeOptions,
    statOptions,
    pinnedSets,
    pinnedArchetypes,
    onTogglePinnedSet,
    onTogglePinnedArchetype,
    filtersActive,
    onClearFilters,
    classOptions: CLASS_OPTIONS,
    armorVersionOptions: ARMOR_VERSION_OPTIONS,
  };

  return (
    <div className="@container/toolbar flex items-center gap-2 px-3 py-4">
      <span
        className="text-muted-foreground shrink-0 text-xs tabular-nums"
        aria-label={`${filteredCount} results`}
      >
        {filteredCount}
      </span>
      <div className="bg-border h-4 w-px shrink-0" aria-hidden />
      <div className="relative min-w-0 flex-1">
        <MagnifyingGlass
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (search) onSearchChange("");
            else e.currentTarget.blur();
          }}
          placeholder="Press F to search"
          aria-label="Search armor by name"
          className="pl-6"
        />
      </div>
      <div className="hidden shrink-0 items-center gap-2.5 @[58rem]/toolbar:flex">
        <FilterMultiselect
          label="Class"
          allLabel="All classes"
          value={facets.classes}
          onChange={(v) => onFacetChange("classes", v)}
          options={CLASS_OPTIONS}
        />
        <FilterMultiselect
          label="Armor"
          allLabel="All armor"
          value={facets.armorVersions}
          onChange={(v) => onFacetChange("armorVersions", v)}
          options={ARMOR_VERSION_OPTIONS}
        />
        <FilterMultiselect
          label="Set"
          allLabel="All sets"
          value={facets.setHashes}
          onChange={(v) => onFacetChange("setHashes", v)}
          options={setOptions}
          searchable
          pinnable
          pinned={pinnedSets}
          onTogglePin={onTogglePinnedSet}
        />
      </div>
      <div className="hidden shrink-0 items-center gap-2.5 @[82.5rem]/toolbar:flex">
        <FilterMultiselect
          label="Archetype"
          allLabel="All archetypes"
          value={facets.archetypes}
          onChange={(v) => onFacetChange("archetypes", v)}
          options={archetypeOptions}
          searchable
          pinnable
          pinned={pinnedArchetypes}
          onTogglePin={onTogglePinnedArchetype}
        />
        <FilterMultiselect<TuningFilter>
          label="Tuning"
          allLabel="Any tuning"
          value={facets.tunings}
          onChange={(v) => onFacetChange("tunings", v)}
          options={[
            ...statOptions,
            { value: "none" as const, label: "Not tunable" },
          ]}
        />
        <FilterMultiselect
          label="Tertiary"
          allLabel="Any tertiary"
          value={facets.tertiaries}
          onChange={(v) => onFacetChange("tertiaries", v)}
          options={statOptions}
        />
      </div>
      <div className="hidden shrink-0 @[58rem]/toolbar:block @[82.5rem]/toolbar:hidden">
        <FilterCascadeMenu
          {...cascadeMenuProps}
          includedFacets={OVERFLOW_FACETS}
          triggerLabel="More filters"
        />
      </div>
      <div className="shrink-0 @[58rem]/toolbar:hidden">
        <FilterCascadeMenu {...cascadeMenuProps} />
      </div>
    </div>
  );
}
