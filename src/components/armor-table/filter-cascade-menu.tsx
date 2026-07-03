"use client";

import { useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { FilterOption } from "@/lib/armor-table/pinned";
import type {
  ArmorVersion,
  FacetFilters,
  TuningFilter,
} from "@/lib/armor-table/filters";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import {
  FilterMultiselectPanel,
  filterMultiselectActiveBadgeClasses,
  filterMultiselectTriggerClasses,
  selectionSummary,
} from "@/components/armor-table/filter-multiselect";

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
    <Menu.SubmenuRoot
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <Menu.SubmenuTrigger
        openOnHover={!toggleOnClick}
        className="justify-between gap-3"
      >
        <span className="shrink-0 font-medium">{label}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-right text-xs">
            {selectionSummary(value, options, allLabel)}
          </span>
          {active && (
            <Badge className={filterMultiselectActiveBadgeClasses}>
              {value.length}
            </Badge>
          )}
          <CaretRight
            weight="duotone"
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        </span>
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner side="inline-end" align="start">
          <Menu.Popup className="w-64 p-0">
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
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
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

  const tuningOptions: FilterOption<TuningFilter>[] = [
    ...statOptions,
    { value: "none" as const, label: "Not tunable" },
  ];

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={
          active
            ? `${triggerLabel} — ${totalSelected} selected`
            : triggerLabel
        }
        data-active={active || undefined}
        className={cn(filterMultiselectTriggerClasses, "min-w-28 shrink-0 box-border")}
      >
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
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
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start">
          <Menu.Popup className="w-56 p-1">
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
            {showClearAll && (
              <>
                <Menu.Separator className="bg-border my-1 h-px" />
                <div className="flex justify-end p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    disabled={!filtersActive}
                    onClick={onClearFilters}
                  >
                    Clear all
                  </Button>
                </div>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
