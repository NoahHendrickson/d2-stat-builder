"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { Input, SearchClearButton } from "@/components/ui/input";
import { SetRow } from "@/components/builder/set-row";
import { SetListControls } from "@/components/builder/set-list-controls";
import { getArchetypes } from "@/lib/armory/archetypes";
import type { ArmorPiece } from "@/lib/armory/normalize";
import {
  hasActiveSetFilters,
  passesSetFilters,
  type SetFilters,
  type SetMinOwned,
} from "@/lib/armory/set-filters";
import { DEFAULT_SET_SORT, sortSets, type SetSortKey } from "@/lib/armory/set-sort";
import { setSlotIcons, type ArmorSetInfo } from "@/lib/armory/sets";
import type { StatIconMap } from "@/lib/armory/stats";
import type { Manifest } from "@/lib/manifest/load";

// The roll grid is opened by few sessions; keep it out of the builder's initial bundle.
const SetGridDialog = dynamic(
  () => import("@/components/builder/set-grid-dialog").then((m) => m.SetGridDialog),
  { ssr: false },
);

/**
 * The Set bonuses list: search, sort/filter, the pinned and unpinned rows, and the one
 * roll-grid modal every row's grid button opens (on that row's set).
 */
export function SetBonusesSection({
  sets,
  setReqs,
  onToggleSet,
  onReset,
  pinnedSets,
  onTogglePin,
  setFilters,
  onSetMinOwnedChange,
  planning,
  pieces,
  manifest,
  classType,
  statIcons,
}: {
  sets: ArmorSetInfo[];
  setReqs: Record<number, 2 | 4>;
  onToggleSet: (setHash: number, count: 2 | 4) => void;
  /** Clears every set requirement. */
  onReset: () => void;
  pinnedSets: number[];
  onTogglePin: (setHash: number) => void;
  setFilters: SetFilters;
  onSetMinOwnedChange: (minOwned: SetMinOwned) => void;
  /**
   * Planning what to farm (Theoretical Builds): every set is listed and any bonus can be
   * required, however few of its pieces are owned — so there's no owned-count filter.
   */
  planning: boolean;
  /** The optimizer pool (what the roll grid counts). */
  pieces: ArmorPiece[];
  manifest?: Manifest;
  classType: number | null;
  statIcons: StatIconMap;
}) {
  const [query, setQuery] = useState("");
  /** Set-list ordering — a view preference, so it's per-session rather than persisted. */
  const [sort, setSort] = useState<SetSortKey>(DEFAULT_SET_SORT);

  const pinned = useMemo(() => new Set(pinnedSets), [pinnedSets]);
  // Pinned sets float to the top; within each group the chosen sort order is kept.
  // Pins for sets outside the current list (e.g. another class) simply don't show.
  // Both groups are narrowed by the search query (case-insensitive substring).
  const { pinnedList, unpinnedList } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = sortSets(
      sets.filter((s) => {
        if (q && !s.name.toLowerCase().includes(q)) return false;
        return planning || passesSetFilters(s.ownedCount, setFilters);
      }),
      sort,
    );
    return {
      pinnedList: shown.filter((s) => pinned.has(s.setHash)),
      unpinnedList: shown.filter((s) => !pinned.has(s.setHash)),
    };
  }, [sets, pinned, query, setFilters, planning, sort]);
  const activeFilters = !planning && hasActiveSetFilters(setFilters);

  // The grid's set pickers follow the list's order — pinned first, each group in the
  // chosen sort — but ignore its search and filters, so every set stays reachable.
  const gridSets = useMemo(() => {
    const sorted = sortSets(sets, sort);
    return [
      ...sorted.filter((s) => pinned.has(s.setHash)),
      ...sorted.filter((s) => !pinned.has(s.setHash)),
    ];
  }, [sets, sort, pinned]);
  const archetypes = useMemo(() => (manifest ? getArchetypes(manifest) : []), [manifest]);
  const getSlotIcons = useCallback(
    (setHash: number) =>
      manifest && classType !== null ? setSlotIcons(manifest, setHash, classType) : {},
    [manifest, classType],
  );

  // One grid modal for the whole list; mounted from its first open on (lazy chunk).
  const [grid, setGrid] = useState<{ open: boolean; setHash: number } | null>(null);
  const openGrid = useCallback((setHash: number) => setGrid({ open: true, setHash }), []);
  const onGridOpenChange = useCallback(
    (open: boolean) => setGrid((g) => (g ? { ...g, open } : g)),
    [],
  );

  const row = (s: ArmorSetInfo, isPinned: boolean) => (
    <SetRow
      key={s.setHash}
      set={s}
      pinned={isPinned}
      req={setReqs[s.setHash]}
      planning={planning}
      onTogglePin={onTogglePin}
      onToggleSet={onToggleSet}
      onOpenGrid={openGrid}
    />
  );

  return (
    <>
      <div className="space-y-2">
        <div className="relative">
          <HugeiconsIcon icon={Search01Icon}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search set bonuses"
            aria-label="Search set bonuses"
            className="h-9 pr-8 pl-8"
          />
          {query.length > 0 && <SearchClearButton onClick={() => setQuery("")} />}
        </div>
        <SetListControls
          count={pinnedList.length + unpinnedList.length}
          sort={sort}
          onSortChange={setSort}
          filters={setFilters}
          onMinOwnedChange={onSetMinOwnedChange}
          planning={planning}
          onReset={onReset}
        />
      </div>
      {sets.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No set-bonus armor found for this class.
        </p>
      ) : pinnedList.length === 0 && unpinnedList.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {query.trim() && activeFilters
            ? `No sets match "${query.trim()}" with the current settings.`
            : query.trim()
              ? `No sets match "${query.trim()}".`
              : activeFilters
                ? "No sets match the current settings."
                : "No sets to show."}
        </p>
      ) : (
        // Figma 17:5731: name · 2pc perk · 4pc perk columns (+ the roll-grid button), 16px row gap.
        // Phones: the name (and grid button) on one line, each perk on its own under it (see SetRow).
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.75fr)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-5">
          {pinnedList.map((s) => row(s, true))}
          {pinnedList.length > 0 && unpinnedList.length > 0 && (
            <div className="border-border col-span-full border-t" aria-hidden />
          )}
          {unpinnedList.map((s) => row(s, false))}
        </div>
      )}
      {grid && (
        <SetGridDialog
          open={grid.open}
          onOpenChange={onGridOpenChange}
          initialSetHash={grid.setHash}
          sets={gridSets}
          pieces={pieces}
          archetypes={archetypes}
          statIcons={statIcons}
          getSlotIcons={getSlotIcons}
        />
      )}
    </>
  );
}
