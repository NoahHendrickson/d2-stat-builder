"use client";

import { memo, type RefObject } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Copy01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { duplicateMatchSummary, type DuplicateMatch } from "@/lib/armor-table/duplicates";
import { cn } from "@/lib/utils";
import { useTouchFirst } from "@/lib/use-min-width";
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
import { FilterCascadeMenu } from "@/components/armor-table/filter-cascade-menu";
import {
  FacetFilterMenu,
  type FacetFilterState,
} from "@/components/armor-table/facet-filter-menu";
import { CleanupButton, type CleanupButtonProps } from "@/components/armor-table/cleanup-button";
import { BUILD_USAGE_PAUSED } from "@/lib/build-usage/paused";

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
    <div className="flex shrink-0">
      <Button
        type="button"
        variant="outline"
        aria-pressed={on}
        title={`Show only pieces with a twin: same ${duplicateMatchSummary(match)}`}
        className={cn("normal:rounded-r-none", on && DUPLICATES_ON)}
        onClick={onToggle}
      >
        <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" aria-hidden />
        <span className="max-md:sr-only">Duplicates</span>
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
 * The table's filter bar: result count, search, the six multiselect filters,
 * and the Cleanup and Duplicates buttons. Sits above the sticky column headers.
 */
export const ArmorTableToolbar = memo(function ArmorTableToolbar({
  search,
  onSearchChange,
  searchRef,
  filters,
  filteredCount,
  duplicateGroups,
  onToggleDuplicates,
  duplicateMatch,
  onDuplicateMatchChange,
  cleanupGroups,
  cleanup,
  filtersActive,
  onClearFilters,
}: {
  search: string;
  onSearchChange: (search: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  filters: FacetFilterState;
  filteredCount: number;
  /** Set while the table shows only duplicates: how many groups it found. */
  duplicateGroups?: number;
  onToggleDuplicates: () => void;
  duplicateMatch: DuplicateMatch;
  /** Changes what twins must share, and shows duplicates. */
  onDuplicateMatchChange: (match: DuplicateMatch) => void;
  /** Set while the table shows Cleanup: how many class + slot groups it found. */
  cleanupGroups?: number;
  cleanup: Omit<CleanupButtonProps, "on">;
  filtersActive: boolean;
  onClearFilters: () => void;
}) {
  // Duplicates and Cleanup are never on together; whichever is shows its groups.
  const groupCount = duplicateGroups ?? cleanupGroups;
  // Touch screens likely have no F key to press. The table mounts after the armory
  // loads, never while hydrating, so this reads the real device on its first render.
  const keyboard = !useTouchFirst();
  const cascadeMenuProps = { filters, filtersActive, onClearFilters };

  return (
    // Phones: search and Filters on the first line, the count and views after.
    <div className="@container/toolbar flex items-center gap-2 px-4 py-5 max-md:flex-wrap max-md:gap-y-3 max-md:px-3 max-md:py-3">
      <span
        className="shrink-0 text-sm font-medium tabular-nums max-md:order-4 max-md:mr-auto"
        aria-label={`${filteredCount} results`}
      >
        {filteredCount} {filteredCount === 1 ? "piece" : "pieces"}
        {groupCount !== undefined && ` in ${groupCount} ${groupCount === 1 ? "group" : "groups"}`}
      </span>
      {/* Phones: search and Filters on a line of their own (the inline filters between them
          are hidden there). Wider, the wrapper adds no box. */}
      <div className="flex min-w-0 basis-full items-center gap-2 md:contents">
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
            placeholder={keyboard ? "Press F to search" : "Search armor"}
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
          <FacetFilterMenu facet="classes" filters={filters} />
          <FacetFilterMenu facet="armorVersions" filters={filters} />
          <FacetFilterMenu facet="setHashes" filters={filters} />
        </div>
        <div className="hidden min-w-0 items-center gap-2 @[82.5rem]/toolbar:flex">
          <FacetFilterMenu facet="archetypes" filters={filters} />
          <FacetFilterMenu facet="tunings" filters={filters} />
          <FacetFilterMenu facet="tertiaries" filters={filters} />
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
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 max-md:order-5">
        {!BUILD_USAGE_PAUSED && <CleanupButton on={cleanupGroups !== undefined} {...cleanup} />}
        <DuplicatesButton
          on={duplicateGroups !== undefined}
          match={duplicateMatch}
          onToggle={onToggleDuplicates}
          onMatchChange={onDuplicateMatchChange}
        />
      </div>
      {filtersActive && (
        <Button
          type="button"
          variant="outline"
          className="shrink-0 max-md:order-6"
          onClick={onClearFilters}
        >
          <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden />
          Clear all
        </Button>
      )}
    </div>
  );
});
