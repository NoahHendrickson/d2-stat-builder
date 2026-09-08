"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { FilterOption } from "@/lib/armor-table/pinned";
import type {
  ArmorVersion,
  FacetFilters,
  TuningFilter,
} from "@/lib/armor-table/filters";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
} from "@/lib/armory/stats";
import { cn } from "@/lib/utils";
import {
  fieldControlInnerTriggerClasses,
  fieldFilterControlShellClasses,
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
  filterMultiselectActiveBadgeClasses,
  selectionSummaryText,
} from "@/components/armor-table/filter-multiselect";

export const STAT_FILTER_OPTIONS: FilterOption<number>[] =
  STAT_DISPLAY_ORDER.map((key) => ({
    value: STAT_ORDER.indexOf(key),
    label: STAT_LABELS[key],
  }));

export const TUNING_FILTER_OPTIONS: FilterOption<TuningFilter>[] = [
  ...STAT_FILTER_OPTIONS,
  { value: "none", label: "Not tunable" },
];

const ALL_FACET_KEYS = [
  "classes",
  "armorVersions",
  "setHashes",
  "archetypes",
  "tunings",
  "tertiaries",
] as const satisfies readonly (keyof FacetFilters)[];

function countFacetSelections(
  facets: FacetFilters,
  keys: readonly (keyof FacetFilters)[] = ALL_FACET_KEYS,
): number {
  return keys.reduce((sum, key) => sum + facets[key].length, 0);
}

function CascadeFacetSubmenu<V extends string | number>({
  label,
  allLabel,
  options,
  value,
  onChange,
  searchable = false,
  pinnable = false,
  pinned = [],
  onTogglePin,
  toggleOnClick = false,
}: {
  label: string;
  allLabel: string;
  options: FilterOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
  toggleOnClick?: boolean;
}) {
  const [query, setQuery] = useState("");
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
            {selectionSummaryText(value, options)}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent side="inline-end" align="start" className="w-64">
        <FilterMultiselectPanel
          allLabel={allLabel}
          options={options}
          value={value}
          onChange={onChange}
          query={query}
          onQueryChange={setQuery}
          searchable={searchable}
          pinnable={pinnable}
          pinned={pinned}
          onTogglePin={onTogglePin}
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
  classOptions,
  armorVersionOptions,
  includedFacets = ALL_FACET_KEYS,
  triggerLabel = "Filters",
  toggleSubmenusOnClick = false,
}: {
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
  filtersActive: boolean;
  onClearFilters: () => void;
  classOptions: FilterOption<number>[];
  armorVersionOptions: FilterOption<ArmorVersion>[];
  includedFacets?: readonly (keyof FacetFilters)[];
  triggerLabel?: string;
  toggleSubmenusOnClick?: boolean;
}) {
  const totalSelected = countFacetSelections(facets, includedFacets);
  const active = totalSelected > 0;
  const showClearAll = includedFacets.length === ALL_FACET_KEYS.length;

  const includes = (key: keyof FacetFilters) => includedFacets.includes(key);

  const tuningOptions = TUNING_FILTER_OPTIONS;

  return (
    <DropdownMenu>
      <div
        className={cn(
          fieldFilterControlShellClasses,
          "min-w-28 shrink-0",
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
            <span className="min-w-0 flex-1 truncate text-left">
              {triggerLabel}
            </span>
            {active && (
              <Badge className={filterMultiselectActiveBadgeClasses}>
                {totalSelected}
              </Badge>
            )}
            <CaretDown
              weight="duotone"
              className="text-muted-foreground pointer-events-none size-4 shrink-0"
              aria-hidden
            />
          </DropdownMenuTrigger>
        </TooltipLabel>
      </div>
      <DropdownMenuContent side="bottom" align="start" className="w-56 p-1">
        {includes("classes") && (
          <CascadeFacetSubmenu
            label="Class"
            allLabel="All classes"
            options={classOptions}
            value={facets.classes}
            onChange={(v) => onFacetChange("classes", v)}
            toggleOnClick={toggleSubmenusOnClick}
          />
        )}
        {includes("armorVersions") && (
          <CascadeFacetSubmenu
            label="Armor"
            allLabel="All armor"
            options={armorVersionOptions}
            value={facets.armorVersions}
            onChange={(v) => onFacetChange("armorVersions", v)}
            toggleOnClick={toggleSubmenusOnClick}
          />
        )}
        {includes("setHashes") && (
          <CascadeFacetSubmenu
            label="Set"
            allLabel="All sets"
            options={setOptions}
            value={facets.setHashes}
            onChange={(v) => onFacetChange("setHashes", v)}
            searchable
            pinnable
            pinned={pinnedSets}
            onTogglePin={onTogglePinnedSet}
            toggleOnClick={toggleSubmenusOnClick}
          />
        )}
        {includes("archetypes") && (
          <CascadeFacetSubmenu
            label="Archetype"
            allLabel="All archetypes"
            options={archetypeOptions}
            value={facets.archetypes}
            onChange={(v) => onFacetChange("archetypes", v)}
            searchable
            pinnable
            pinned={pinnedArchetypes}
            onTogglePin={onTogglePinnedArchetype}
            toggleOnClick={toggleSubmenusOnClick}
          />
        )}
        {includes("tunings") && (
          <CascadeFacetSubmenu<TuningFilter>
            label="Tuning"
            allLabel="Any tuning"
            options={tuningOptions}
            value={facets.tunings}
            onChange={(v) => onFacetChange("tunings", v)}
            toggleOnClick={toggleSubmenusOnClick}
          />
        )}
        {includes("tertiaries") && (
          <CascadeFacetSubmenu
            label="Tertiary"
            allLabel="Any tertiary"
            options={statOptions}
            value={facets.tertiaries}
            onChange={(v) => onFacetChange("tertiaries", v)}
            toggleOnClick={toggleSubmenusOnClick}
          />
        )}
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
