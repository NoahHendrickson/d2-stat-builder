"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import type { FacetFilters } from "@/lib/armor-table/filters";
import {
  FACET_KEYS,
  type FacetKey,
  type FacetValue,
} from "@/lib/armor-table/facets";
import { cn } from "@/lib/utils";
import {
  fieldControlInnerTriggerClasses,
  fieldFilterActiveEdgeClasses,
  fieldFilterControlShellClasses,
  fieldFilterIdleClasses,
} from "@/lib/field-surface";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FilterMultiselectPanel,
  selectionSummaryText,
} from "@/components/armor-table/filter-multiselect";
import type {
  FacetFilterState,
  FacetSpec,
} from "@/components/armor-table/facet-filter-menu";

function countFacetSelections(
  facets: FacetFilters,
  keys: readonly FacetKey[],
): number {
  return keys.reduce((sum, key) => sum + facets[key].length, 0);
}

function CascadeFacetSubmenu<K extends FacetKey>({
  facet,
  filters,
  toggleOnClick = false,
}: {
  facet: K;
  filters: FacetFilterState;
  toggleOnClick?: boolean;
}) {
  const [query, setQuery] = useState("");
  const { label, ...spec } = filters.specs[facet] as FacetSpec<FacetValue<K>>;
  const value = filters.facets[facet] as FacetValue<K>[];
  const active = value.length > 0;

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <DropdownMenuSubTrigger openOnHover={!toggleOnClick}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active ? (
          <span className="text-muted-foreground max-w-24 truncate text-xs">
            {selectionSummaryText(value, spec.options)}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        side="inline-end"
        align="start"
        className={spec.searchable ? "w-64" : "w-max"}
      >
        <FilterMultiselectPanel<FacetValue<K>>
          {...spec}
          value={value}
          onChange={(v) => filters.onFacetChange(facet, v as FacetFilters[K])}
          query={query}
          onQueryChange={setQuery}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Compact filter control for narrow viewports: one trigger opens a root menu
 * with flyout submenus for each facet category.
 */
export function FilterCascadeMenu({
  filters,
  filtersActive,
  onClearFilters,
  includedFacets = FACET_KEYS,
  triggerLabel = "Filters",
  toggleSubmenusOnClick = false,
}: {
  filters: FacetFilterState;
  filtersActive: boolean;
  onClearFilters: () => void;
  includedFacets?: readonly FacetKey[];
  triggerLabel?: string;
  toggleSubmenusOnClick?: boolean;
}) {
  const totalSelected = countFacetSelections(filters.facets, includedFacets);
  const active = totalSelected > 0;
  const showClearAll = includedFacets.length === FACET_KEYS.length;

  return (
    <DropdownMenu>
      <div
        className={cn(
          fieldFilterControlShellClasses,
          // Hovers like the toolbar's other quick filters and outlined buttons.
          "d2-hover-ring min-w-28 shrink-0 transition-[color,background-color,border-color,outline-offset]",
          active ? fieldFilterActiveEdgeClasses : fieldFilterIdleClasses,
        )}
        data-active={active || undefined}
      >
        <TooltipLabel
          label={
            active
              ? `${triggerLabel} — ${totalSelected} selected`
              : triggerLabel
          }
        >
          <DropdownMenuTrigger
            aria-label={
              active
                ? `${triggerLabel} — ${totalSelected} selected`
                : triggerLabel
            }
            className={fieldControlInnerTriggerClasses}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                !active && "text-foreground/70",
              )}
            >
              {triggerLabel}
            </span>
            {active && (
              <Badge className="h-4 shrink-0 border-transparent bg-white/20 px-1 text-[10px] text-white tabular-nums">
                {totalSelected}
              </Badge>
            )}
            <HugeiconsIcon icon={UnfoldMoreIcon}
              className={cn(
                "pointer-events-none size-4 shrink-0",
                active ? "text-white" : "text-foreground/70",
              )}
              aria-hidden
            />
          </DropdownMenuTrigger>
        </TooltipLabel>
      </div>
      <DropdownMenuContent side="bottom" align="start" className="w-56 p-1">
        {FACET_KEYS.filter((key) => includedFacets.includes(key)).map((key) => (
          <CascadeFacetSubmenu
            key={key}
            facet={key}
            filters={filters}
            toggleOnClick={toggleSubmenusOnClick}
          />
        ))}
        {showClearAll && filtersActive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClearFilters}>
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
