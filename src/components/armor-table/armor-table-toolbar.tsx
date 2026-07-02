"use client";

import type { RefObject } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { FilterOption } from "@/lib/armor-table/pinned";
import type { FacetFilters, TuningFilter } from "@/lib/armor-table/filters";
import { ARMOR_SLOTS, CLASS_NAMES, SLOT_LABELS } from "@/lib/armory/stats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";

const CLASS_OPTIONS: FilterOption<number>[] = [0, 1, 2].map((c) => ({
  value: c,
  label: CLASS_NAMES[c],
}));

const SLOT_OPTIONS: FilterOption<(typeof ARMOR_SLOTS)[number]>[] =
  ARMOR_SLOTS.map((s) => ({ value: s, label: SLOT_LABELS[s] }));

/**
 * The table's filter bar: search, the six multiselect filters, and the
 * result count + clear-all. Lives in the table frame's header row, above the
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
  totalCount,
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
  totalCount: number;
  filtersActive: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-3">
      <div className="relative min-w-56 flex-1">
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
      <div className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-3 xl:flex xl:w-auto xl:*:w-40">
        <FilterMultiselect
          allLabel="All classes"
          value={facets.classes}
          onChange={(v) => onFacetChange("classes", v)}
          options={CLASS_OPTIONS}
        />
        <FilterMultiselect
          allLabel="All slots"
          value={facets.slots}
          onChange={(v) => onFacetChange("slots", v)}
          options={SLOT_OPTIONS}
        />
        <FilterMultiselect
          allLabel="All sets"
          value={facets.setHashes}
          onChange={(v) => onFacetChange("setHashes", v)}
          options={setOptions}
          searchable
          pinnable
          pinned={pinnedSets}
          onTogglePin={onTogglePinnedSet}
        />
        <FilterMultiselect
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
          allLabel="Any tuning"
          value={facets.tunings}
          onChange={(v) => onFacetChange("tunings", v)}
          options={[
            ...statOptions,
            { value: "none" as const, label: "Not tunable" },
          ]}
        />
        <FilterMultiselect
          allLabel="Any tertiary"
          value={facets.tertiaries}
          onChange={(v) => onFacetChange("tertiaries", v)}
          options={statOptions}
        />
      </div>
      <div className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
        <span className="tabular-nums">
          {filteredCount} of {totalCount} pieces
        </span>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={onClearFilters}
          >
            <X aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
