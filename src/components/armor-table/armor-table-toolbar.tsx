"use client";

import { memo, type RefObject } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Copy01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { FilterOption } from "@/lib/armor-table/pinned";
import type { ArmorVersion, FacetFilters } from "@/lib/armor-table/filters";
import { duplicateMatchSummary, type DuplicateMatch } from "@/lib/armor-table/duplicates";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, SearchClearButton } from "@/components/ui/input";
import {
  FilterCascadeMenu,
  TUNING_FILTER_OPTIONS,
} from "@/components/armor-table/filter-cascade-menu";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";
import { SetFilterMenu } from "@/components/set-menu";

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
 * Both halves of the Duplicates split button turn amber while it's on, outline included:
 * a solid amber border in place of d2-line's gradient (important, so it beats the
 * plain-line and Normal theme rules too).
 */
const DUPLICATES_ON =
  "bg-amber-500/22 text-amber-800 hover:bg-amber-500/30 aria-expanded:bg-amber-500/30 dark:text-amber-200 [border-image-source:none]! border-amber-500/55! hover:border-amber-500/75! aria-expanded:border-amber-500/75!";

/**
 * Duplicates as a split button: the left half shows or hides only twinned pieces, the
 * arrow opens what twins must share beyond set, slot, and archetype.
 */
function DuplicatesButton({
  on,
  match,
  onToggle,
  onMatchChange,
}: {
  on: boolean;
  match: DuplicateMatch;
  onToggle: () => void;
  onMatchChange: (match: DuplicateMatch) => void;
}) {
  return (
    <div className="ml-auto flex shrink-0">
      <Button
        type="button"
        variant="outline"
        aria-pressed={on}
        title={`Show only pieces with a twin: same ${duplicateMatchSummary(match)}`}
        className={cn("normal:rounded-r-none", on && DUPLICATES_ON)}
        onClick={onToggle}
      >
        <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" aria-hidden />
        Duplicates
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="What duplicates must share"
          render={
            <Button
              variant="outline"
              size="icon"
              className={cn("-ml-px w-7 normal:rounded-l-none", on && DUPLICATES_ON)}
            />
          }
        >
          <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Duplicates must share</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              indicator="start"
              closeOnClick={false}
              checked={match.tuning}
              onCheckedChange={(checked) => onMatchChange({ ...match, tuning: checked === true })}
            >
              Same tuning
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              indicator="start"
              closeOnClick={false}
              checked={match.tertiary}
              onCheckedChange={(checked) => onMatchChange({ ...match, tertiary: checked === true })}
            >
              Same tertiary
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The table's filter bar: result count, search, and the six multiselect
 * filters. Sits above the sticky column headers.
 */
export const ArmorTableToolbar = memo(function ArmorTableToolbar({
  search,
  onSearchChange,
  searchRef,
  facets,
  onFacetChange,
  setOptions,
  archetypeOptions,
  statOptions,
  pinnedArchetypes,
  onTogglePinnedArchetype,
  filteredCount,
  duplicateGroups,
  onToggleDuplicates,
  duplicateMatch,
  onDuplicateMatchChange,
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
  pinnedArchetypes: string[];
  onTogglePinnedArchetype: (name: string) => void;
  filteredCount: number;
  /** Set while the table shows only duplicates: how many groups it found. */
  duplicateGroups?: number;
  onToggleDuplicates: () => void;
  duplicateMatch: DuplicateMatch;
  /** Changes what twins must share, and shows duplicates. */
  onDuplicateMatchChange: (match: DuplicateMatch) => void;
  filtersActive: boolean;
  onClearFilters: () => void;
}) {
  const cascadeMenuProps = {
    facets,
    onFacetChange,
    setOptions,
    archetypeOptions,
    statOptions,
    pinnedArchetypes,
    onTogglePinnedArchetype,
    filtersActive,
    onClearFilters,
    classOptions: CLASS_OPTIONS,
    armorVersionOptions: ARMOR_VERSION_OPTIONS,
  };

  return (
    <div className="@container/toolbar flex items-center gap-2 px-4 py-5">
      <span
        className="shrink-0 text-sm font-medium tabular-nums"
        aria-label={`${filteredCount} results`}
      >
        {filteredCount} {filteredCount === 1 ? "piece" : "pieces"}
        {duplicateGroups !== undefined &&
          ` in ${duplicateGroups} ${duplicateGroups === 1 ? "group" : "groups"}`}
      </span>
      <div className="relative h-8 min-w-0 flex-1 @[58rem]/toolbar:w-[272px] @[58rem]/toolbar:flex-none">
        <HugeiconsIcon icon={Search01Icon}
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2"
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
          className="h-8 pr-8 pl-8"
        />
        {search.length > 0 && (
          <SearchClearButton
            onClick={() => {
              onSearchChange("");
              searchRef.current?.focus();
            }}
          />
        )}
      </div>
      <div className="hidden min-w-0 items-center gap-2 @[58rem]/toolbar:flex">
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
        <SetFilterMenu
          value={facets.setHashes}
          onChange={(v) => onFacetChange("setHashes", v)}
          options={setOptions}
        />
      </div>
      <div className="hidden min-w-0 items-center gap-2 @[82.5rem]/toolbar:flex">
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
        <FilterMultiselect
          label="Tuning"
          allLabel="Any tuning"
          value={facets.tunings}
          onChange={(v) => onFacetChange("tunings", v)}
          options={TUNING_FILTER_OPTIONS}
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
      <div className="h-8 shrink-0 @[58rem]/toolbar:hidden">
        <FilterCascadeMenu {...cascadeMenuProps} toggleSubmenusOnClick />
      </div>
      <DuplicatesButton
        on={duplicateGroups !== undefined}
        match={duplicateMatch}
        onToggle={onToggleDuplicates}
        onMatchChange={onDuplicateMatchChange}
      />
      {filtersActive && (
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={onClearFilters}
        >
          <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden />
          Clear all
        </Button>
      )}
    </div>
  );
});
