"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { availableSets } from "@/lib/armory/sets";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  tertiaryStatIndex,
} from "@/lib/armory/stats";
import {
  DEFAULT_SORT,
  emptyFacets,
  hasActiveFilters,
  pieceMatchesFilters,
  type FacetFilters,
  type SortKey,
  type SortState,
} from "@/lib/armor-table/filters";
import { DESC_FIRST, compareRows } from "@/lib/armor-table/sort";
import { tokenizeSearchQuery } from "@/lib/armor-table/search";
import {
  TABLE_SCHEMA_VERSION,
  loadTableState,
  saveTableState,
} from "@/lib/armor-table/filter-storage";
import { togglePinned, type FilterOption } from "@/lib/armor-table/pinned";
import {
  PINS_SCHEMA_VERSION,
  loadTablePins,
  saveTablePins,
} from "@/lib/armor-table/pin-storage";
import { cn } from "@/lib/utils";
import { ArmorTableToolbar } from "@/components/armor-table/armor-table-toolbar";
import {
  ArmorRow,
  COLUMN_COUNT,
  TABLE_COLGROUP,
  type Row,
} from "@/components/armor-table/armor-table-row";
import { NewDropsFeed } from "@/components/armor-table/new-drops-feed";

/** Approximate single-row height; the virtualizer remeasures real rows on mount. */
const ESTIMATED_ROW_HEIGHT_PX = 38;

const TABLE_HEAD_CELL =
  "border-border/50 border-b bg-muted py-2.5 pr-3 text-sm font-medium whitespace-nowrap first:pl-3";

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  title,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={TABLE_HEAD_CELL}>
      <button
        type="button"
        title={title}
        onClick={() => onSort(sortKey)}
        className={cn(
          "hover:text-foreground -my-0.5 inline-flex items-center gap-0.5 transition-colors",
          align === "right" && "w-full justify-end",
          active && "text-foreground",
        )}
      >
        {label}
        {active &&
          (sort.asc ? (
            <CaretUp weight="bold" className="size-3" aria-hidden />
          ) : (
            <CaretDown weight="bold" className="size-3" aria-hidden />
          ))}
      </button>
    </th>
  );
}

export function ArmorTable() {
  const armory = useArmory();
  const manifestStatus = useManifest();
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<FacetFilters>(emptyFacets);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [pinnedSets, setPinnedSets] = useState<number[]>([]);
  const [pinnedArchetypes, setPinnedArchetypes] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  // Restore the last session's filters + sort + pins on mount (absent/corrupt
  // → defaults).
  useEffect(() => {
    const saved = loadTableState();
    if (saved) {
      const { search: savedSearch, ...savedFacets } = saved.filters;
      setSearch(savedSearch);
      setFacets(savedFacets);
      setSort(saved.sort);
    }
    const savedPins = loadTablePins();
    if (savedPins) {
      setPinnedSets(savedPins.sets);
      setPinnedArchetypes(savedPins.archetypes);
    }
    restored.current = true;
  }, []);

  // Persist on change (debounced). The `restored` guard prevents the first render
  // from clobbering stored data before the restore runs.
  useEffect(() => {
    if (!restored.current) return;
    const t = window.setTimeout(() => {
      saveTableState({
        version: TABLE_SCHEMA_VERSION,
        filters: { ...facets, search },
        sort,
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [facets, search, sort]);

  // Pins persist debounced like the filters above — the delay also keeps the
  // initial empty state from clobbering stored pins before the restore's
  // setState commits (StrictMode re-runs this effect before the re-render).
  useEffect(() => {
    if (!restored.current) return;
    const t = window.setTimeout(() => {
      saveTablePins({
        version: PINS_SCHEMA_VERSION,
        sets: pinnedSets,
        archetypes: pinnedArchetypes,
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [pinnedSets, pinnedArchetypes]);

  // Global "F" focuses search (ignored while typing in any field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pieces = armory.data?.pieces;
  const characters: ArmoryCharacter[] = armory.data?.characters ?? [];

  const rows = useMemo<Row[]>(() => {
    if (!pieces || !manifest) return [];
    const setNames = new Map(
      availableSets(pieces, manifest).map((s) => [s.setHash, s.name]),
    );
    return pieces.map((piece) => ({
      piece,
      setName: piece.setHash ? setNames.get(piece.setHash) : undefined,
      // The archetype shape (30/25/20) only exists on Armor 3.0 rolls; a tuning
      // socket implies Armor 3.0 even if the archetype plug wasn't resolved.
      tertiary:
        piece.archetype !== undefined || piece.tunedStat !== undefined
          ? tertiaryStatIndex(piece.baseStats)
          : undefined,
    }));
  }, [pieces, manifest]);

  const setOptions = useMemo<FilterOption<number>[]>(() => {
    const seen = new Map<number, string>();
    for (const r of rows) {
      if (r.piece.setHash && r.setName) seen.set(r.piece.setHash, r.setName);
    }
    return [...seen]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([hash, name]) => ({ value: hash, label: name }));
  }, [rows]);

  const archetypeOptions = useMemo<FilterOption<string>[]>(() => {
    const seen = new Set<string>();
    for (const r of rows) if (r.piece.archetype) seen.add(r.piece.archetype);
    return [...seen].sort().map((name) => ({ value: name, label: name }));
  }, [rows]);

  const statOptions: FilterOption<number>[] = STAT_DISPLAY_ORDER.map((key) => ({
    value: STAT_ORDER.indexOf(key),
    label: STAT_LABELS[key],
  }));

  // Search is deferred so the filter pass can lag typing without blocking input.
  const deferredSearch = useDeferredValue(search);
  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearch),
    [deferredSearch],
  );

  const filtered = useMemo(() => {
    const matches = rows.filter((r) =>
      pieceMatchesFilters(r.piece, r.tertiary, facets, searchTokens),
    );
    return matches.sort((a, b) => compareRows(a, b, sort));
  }, [rows, facets, searchTokens, sort]);

  const filtersActive = hasActiveFilters({ ...facets, search });

  const clearFilters = () => {
    setSearch("");
    setFacets(emptyFacets());
  };

  const setFacet = <K extends keyof FacetFilters>(
    key: K,
    value: FacetFilters[K],
  ) => setFacets((f) => ({ ...f, [key]: value }));

  const togglePinnedSet = (hash: number) =>
    setPinnedSets((prev) => togglePinned(prev, hash));

  const togglePinnedArchetype = (name: string) =>
    setPinnedArchetypes((prev) => togglePinned(prev, name));

  const handleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, asc: !prev.asc }
        : { key, asc: !DESC_FIRST.has(key) },
    );

  // Virtualized rows: the scroller is the bounded-height container below.
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollerEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  // Stable identity so memoized rows don't re-render when unrelated state changes.
  const { refetch } = armory;
  const refresh = useCallback(() => void refetch(), [refetch]);

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      {/* The table frame: toolbar row + column headers stack as one header
          anatomy — the toolbar sits outside the scroller so it survives
          horizontal scrolling, the thead stays sticky inside it. */}
      <div className="border-border/50 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="border-border/50 bg-muted border-b">
          <ArmorTableToolbar
            search={search}
            onSearchChange={setSearch}
            searchRef={searchRef}
            facets={facets}
            onFacetChange={setFacet}
            setOptions={setOptions}
            archetypeOptions={archetypeOptions}
            statOptions={statOptions}
            pinnedSets={pinnedSets}
            pinnedArchetypes={pinnedArchetypes}
            onTogglePinnedSet={togglePinnedSet}
            onTogglePinnedArchetype={togglePinnedArchetype}
            filteredCount={filtered.length}
            totalCount={rows.length}
            filtersActive={filtersActive}
            onClearFilters={clearFilters}
          />
        </div>
        <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[78rem] table-fixed text-sm">
            {TABLE_COLGROUP}
            <thead className="bg-muted sticky top-0 z-10">
              <tr className="text-muted-foreground text-left">
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={handleSort} />
                <SortHeader label="Class" sortKey="class" sort={sort} onSort={handleSort} />
                <SortHeader label="Slot" sortKey="slot" sort={sort} onSort={handleSort} />
                <SortHeader label="Archetype" sortKey="archetype" sort={sort} onSort={handleSort} />
                <SortHeader label="Tertiary" sortKey="tertiary" sort={sort} onSort={handleSort} />
                <SortHeader label="Tuned" sortKey="tuned" sort={sort} onSort={handleSort} />
                <SortHeader label="Set bonus" sortKey="set" sort={sort} onSort={handleSort} />
                {STAT_DISPLAY_ORDER.map((key) => (
                  <SortHeader
                    key={key}
                    label={STAT_LABELS[key].slice(0, 3)}
                    title={STAT_LABELS[key]}
                    sortKey={`stat-${key}`}
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                  />
                ))}
                <SortHeader label="Location" sortKey="location" sort={sort} onSort={handleSort} />
                <th className={cn(TABLE_HEAD_CELL, "text-left")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={COLUMN_COUNT} style={{ height: paddingTop }} />
                </tr>
              )}
              {virtualRows.map((vRow) => {
                const row = filtered[vRow.index];
                return (
                  <ArmorRow
                    key={row.piece.instanceId}
                    row={row}
                    characters={characters}
                    onRefresh={refresh}
                    dataIndex={vRow.index}
                    measureRef={rowVirtualizer.measureElement}
                  />
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={COLUMN_COUNT} style={{ height: paddingBottom }} />
                </tr>
              )}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-muted-foreground border-border/50 border-t py-6 text-center text-sm">
              {rows.length === 0
                ? "No armor pieces loaded yet."
                : "No armor matches your filters."}
            </p>
          )}
        </div>
      </div>
      <NewDropsFeed rows={rows} />
    </div>
  );
}
