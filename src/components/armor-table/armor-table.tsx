"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { availableSets } from "@/lib/armory/sets";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import {
  STAT_DISPLAY_ORDER,
  STAT_HASHES,
  STAT_LABELS,
  STAT_ORDER,
  tertiaryStatIndex,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  emptyFacets,
  hasActiveFilters,
  pieceMatchesFilters,
  type CustomOrderColumn,
  type FacetFilters,
  type SortKey,
  type SortState,
} from "@/lib/armor-table/filters";
import type { SortMode } from "@/lib/armor-table/sort";
import { normalizeSearchText, tokenizeSearchQuery } from "@/lib/armor-table/search";
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
import { STAT_FILTER_OPTIONS } from "@/components/armor-table/filter-cascade-menu";
import {
  ArmorRow,
  COLUMN_COUNT,
  TABLE_COLGROUP,
  type Row,
} from "@/components/armor-table/armor-table-row";
import {
  SortMenu,
  TABLE_HEADER_BG,
} from "@/components/armor-table/sort-menu";
import { useArmorTableSort } from "@/components/armor-table/use-armor-table-sort";

/** Approximate single-row height; the virtualizer remeasures real rows on mount. */
const ESTIMATED_ROW_HEIGHT_PX = 48;

const TABLE_HEAD_CELL =
  "border-border/50 border-b py-2.5 pr-3 text-sm font-medium whitespace-nowrap first:pl-3 " +
  TABLE_HEADER_BG;

/** Header-cell order → sort key; `undefined` marks unsortable columns (Actions). */
const COLUMN_SORT_KEYS: readonly (SortKey | undefined)[] = [
  "name",
  "class",
  "archetype",
  "tertiary",
  "tuned",
  "set",
  ...STAT_DISPLAY_ORDER.map((key) => `stat-${key}` as const),
  undefined, // actions
];

const HeaderRow = memo(function HeaderRow({
  tableEl,
  sort,
  sortUndo,
  statIcons,
  columnValues,
  applyMode,
  clearLevel,
  reorderCustom,
  undoSort,
}: {
  tableEl: HTMLTableElement | null;
  sort: SortState;
  sortUndo: SortState | null;
  statIcons: StatIconMap;
  columnValues: (key: SortKey) => string[] | undefined;
  applyMode: (
    key: SortKey,
    mode: SortMode,
    nest: boolean,
    order?: string[],
  ) => void;
  clearLevel: (key: SortKey) => void;
  reorderCustom: (key: CustomOrderColumn, from: number, to: number) => void;
  undoSort: () => void;
}) {
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  useEffect(() => {
    if (!tableEl) return;
    const onOver = (e: PointerEvent) => {
      const cell = (e.target as Element).closest("td,th");
      setHoveredCol(
        cell instanceof HTMLTableCellElement ? cell.cellIndex : null,
      );
    };
    const onLeave = () => setHoveredCol(null);
    tableEl.addEventListener("pointerover", onOver);
    tableEl.addEventListener("pointerleave", onLeave);
    return () => {
      tableEl.removeEventListener("pointerover", onOver);
      tableEl.removeEventListener("pointerleave", onLeave);
    };
  }, [tableEl]);
  const hoveredSortKey =
    hoveredCol !== null ? COLUMN_SORT_KEYS[hoveredCol] : undefined;

  return (
    <thead className={cn("sticky top-0 z-10", TABLE_HEADER_BG)}>
      <tr className="text-muted-foreground text-left">
        <SortMenu
          label="Name"
          sortKey="name"
          sort={sort}
          hovered={hoveredSortKey === "name"}
          sortUndo={sortUndo}
          values={columnValues("name")}
          onApplyMode={applyMode}
          onClearLevel={clearLevel}
          onReorderCustom={reorderCustom}
          onUndoSort={undoSort}
        />
        <SortMenu
          label="Class"
          sortKey="class"
          sort={sort}
          hovered={hoveredSortKey === "class"}
          sortUndo={sortUndo}
          values={columnValues("class")}
          onApplyMode={applyMode}
          onClearLevel={clearLevel}
          onReorderCustom={reorderCustom}
          onUndoSort={undoSort}
        />
        <SortMenu
          label="Archetype"
          sortKey="archetype"
          sort={sort}
          hovered={hoveredSortKey === "archetype"}
          sortUndo={sortUndo}
          values={columnValues("archetype")}
          onApplyMode={applyMode}
          onClearLevel={clearLevel}
          onReorderCustom={reorderCustom}
          onUndoSort={undoSort}
        />
        <SortMenu
          label="Tertiary"
          sortKey="tertiary"
          sort={sort}
          hovered={hoveredSortKey === "tertiary"}
          sortUndo={sortUndo}
          values={columnValues("tertiary")}
          onApplyMode={applyMode}
          onClearLevel={clearLevel}
          onReorderCustom={reorderCustom}
          onUndoSort={undoSort}
        />
        <SortMenu
          label="Tuned"
          sortKey="tuned"
          sort={sort}
          hovered={hoveredSortKey === "tuned"}
          sortUndo={sortUndo}
          values={columnValues("tuned")}
          onApplyMode={applyMode}
          onClearLevel={clearLevel}
          onReorderCustom={reorderCustom}
          onUndoSort={undoSort}
        />
        <SortMenu
          label="Set bonus"
          sortKey="set"
          sort={sort}
          hovered={hoveredSortKey === "set"}
          sortUndo={sortUndo}
          values={columnValues("set")}
          onApplyMode={applyMode}
          onClearLevel={clearLevel}
          onReorderCustom={reorderCustom}
          onUndoSort={undoSort}
        />
        {STAT_DISPLAY_ORDER.map((key) => (
          <SortMenu
            key={key}
            label={STAT_LABELS[key]}
            icon={statIcons[key]}
            title={STAT_LABELS[key]}
            align="right"
            sortKey={`stat-${key}`}
            sort={sort}
            hovered={hoveredSortKey === `stat-${key}`}
            sortUndo={sortUndo}
            onApplyMode={applyMode}
            onClearLevel={clearLevel}
            onReorderCustom={reorderCustom}
            onUndoSort={undoSort}
          />
        ))}
        <th className={cn(TABLE_HEAD_CELL, "text-left")}>Actions</th>
      </tr>
    </thead>
  );
});

export function ArmorTable() {
  const armory = useArmory();
  const manifestStatus = useManifest();
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  // Filters + pins initialize straight from storage (sort does the same inside
  // useArmorTableSort), so the first render is already the restored table.
  const [initialFilters] = useState(() => {
    const saved = loadTableState();
    if (!saved) return null;
    const { search, ...facets } = saved.filters;
    return { search, facets };
  });
  const [initialPins] = useState(loadTablePins);
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [facets, setFacets] = useState<FacetFilters>(
    () => initialFilters?.facets ?? emptyFacets(),
  );
  const [pinnedSets, setPinnedSets] = useState<number[]>(
    () => initialPins?.sets ?? [],
  );
  const [pinnedArchetypes, setPinnedArchetypes] = useState<string[]>(
    () => initialPins?.archetypes ?? [],
  );
  const searchRef = useRef<HTMLInputElement>(null);

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
      searchName: normalizeSearchText(piece.name),
    }));
  }, [pieces, manifest]);

  const {
    sort,
    sortUndo,
    applyMode,
    clearLevel,
    reorderCustom,
    undoSort,
    sortRows,
    columnValues,
  } = useArmorTableSort(rows);

  // Persist filters + sort together (debounced).
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveTableState({
        version: TABLE_SCHEMA_VERSION,
        filters: { ...facets, search },
        sort,
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [facets, search, sort]);

  // Pins persist debounced like the filters above.
  useEffect(() => {
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

  const statIcons = useMemo(() => {
    const out = {} as StatIconMap;
    if (manifest) {
      for (const key of STAT_ORDER) {
        out[key] = manifest.def(
          "DestinyStatDefinition",
          STAT_HASHES[key],
        )?.displayProperties?.icon;
      }
    }
    return out;
  }, [manifest]);

  // Search is deferred so the filter pass can lag typing without blocking input.
  const deferredSearch = useDeferredValue(search);
  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearch),
    [deferredSearch],
  );

  const sorted = useMemo(
    () => sortRows([...rows]),
    [rows, sortRows],
  );
  const filtered = useMemo(
    () =>
      sorted.filter((r) =>
        pieceMatchesFilters(
          r.piece,
          r.tertiary,
          facets,
          searchTokens,
          r.searchName,
        ),
      ),
    [sorted, facets, searchTokens],
  );

  const filtersActive = hasActiveFilters({ ...facets, search });

  const clearFilters = useCallback(() => {
    setSearch("");
    setFacets(emptyFacets());
  }, []);

  const setFacet = useCallback(
    <K extends keyof FacetFilters>(key: K, value: FacetFilters[K]) =>
      setFacets((f) => ({ ...f, [key]: value })),
    [],
  );

  const togglePinnedSet = useCallback(
    (hash: number) => setPinnedSets((prev) => togglePinned(prev, hash)),
    [],
  );

  const togglePinnedArchetype = useCallback(
    (name: string) => setPinnedArchetypes((prev) => togglePinned(prev, name)),
    [],
  );

  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);

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
    <div className="border-border/50 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
      {/* Toolbar + column headers share one tinted header band. The toolbar
          sits outside the scroller so it survives horizontal scroll; thead
          stays sticky inside it. */}
      <div className={cn("border-border/50 shrink-0 border-b", TABLE_HEADER_BG)}>
          <ArmorTableToolbar
            search={search}
            onSearchChange={setSearch}
            searchRef={searchRef}
            facets={facets}
            onFacetChange={setFacet}
            setOptions={setOptions}
            archetypeOptions={archetypeOptions}
            statOptions={STAT_FILTER_OPTIONS}
            pinnedSets={pinnedSets}
            pinnedArchetypes={pinnedArchetypes}
            onTogglePinnedSet={togglePinnedSet}
            onTogglePinnedArchetype={togglePinnedArchetype}
            filteredCount={filtered.length}
            filtersActive={filtersActive}
            onClearFilters={clearFilters}
          />
      </div>
      <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-auto">
          <table
            ref={setTableEl}
            className="w-full min-w-[66rem] table-fixed text-sm"
          >
            {TABLE_COLGROUP}
            <HeaderRow
              tableEl={tableEl}
              sort={sort}
              sortUndo={sortUndo}
              statIcons={statIcons}
              columnValues={columnValues}
              applyMode={applyMode}
              clearLevel={clearLevel}
              reorderCustom={reorderCustom}
              undoSort={undoSort}
            />
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
            <p className="text-muted-foreground border-border border-t py-6 text-center text-sm">
              {rows.length === 0
                ? "No armor pieces loaded yet."
                : "No armor matches your filters."}
            </p>
          )}
      </div>
    </div>
  );
}
