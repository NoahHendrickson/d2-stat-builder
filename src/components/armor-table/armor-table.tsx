"use client";

import Image from "next/image";
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
import { CaretDown, CaretUp, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { availableSets } from "@/lib/armory/sets";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  ARMOR_SLOTS,
  CLASS_NAMES,
  SLOT_LABELS,
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
  type TuningFilter,
} from "@/lib/armor-table/filters";
import {
  DESC_FIRST,
  LOCATION_LABELS,
  compareRows,
  statLabel,
} from "@/lib/armor-table/sort";
import { tokenizeSearchQuery } from "@/lib/armor-table/search";
import {
  TABLE_SCHEMA_VERSION,
  loadTableState,
  saveTableState,
} from "@/lib/armor-table/filter-storage";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArmorRowActions } from "@/components/armor-table/armor-row-actions";

/** Approximate single-row height; the virtualizer remeasures real rows on mount. */
const ESTIMATED_ROW_HEIGHT_PX = 38;

const COLUMN_COUNT = 15;

/** Fixed column widths keep the layout steady while rows virtualize in and out. */
const TABLE_COLGROUP = (
  <colgroup>
    <col /* name */ />
    <col style={{ width: "4.5rem" }} /* class */ />
    <col style={{ width: "5rem" }} /* slot */ />
    <col style={{ width: "6.5rem" }} /* archetype */ />
    <col style={{ width: "5rem" }} /* tertiary */ />
    <col style={{ width: "5rem" }} /* tuned */ />
    <col style={{ width: "9.5rem" }} /* set */ />
    {STAT_ORDER.map((key) => (
      <col key={key} style={{ width: "3rem" }} />
    ))}
    <col style={{ width: "5.5rem" }} /* location */ />
    <col style={{ width: "8rem" }} /* actions */ />
  </colgroup>
);

interface Row {
  piece: ArmorPiece;
  setName?: string;
  /** Tertiary archetype stat index — Armor 3.0 pieces only. */
  tertiary?: number;
}

interface FilterOption<V> {
  value: V;
  label: string;
}

const MAX_SUMMARY_LABELS = 2;

/** Trigger text: "All …" when nothing is selected, else "A, B +n". */
function selectionSummary<V>(
  selected: readonly V[] | null,
  options: readonly FilterOption<V>[],
  allLabel: string,
) {
  if (!selected || selected.length === 0) {
    return <span className="text-muted-foreground">{allLabel}</span>;
  }
  const labels = selected.map(
    (v) => options.find((o) => Object.is(o.value, v))?.label ?? String(v),
  );
  const shown = labels.slice(0, MAX_SUMMARY_LABELS).join(", ");
  return labels.length > MAX_SUMMARY_LABELS
    ? `${shown} +${labels.length - MAX_SUMMARY_LABELS}`
    : shown;
}

function MultiFilterSelect<V>({
  allLabel,
  value,
  onChange,
  options,
}: {
  allLabel: string;
  value: V[];
  onChange: (value: V[]) => void;
  options: FilterOption<V>[];
}) {
  return (
    <Select
      multiple
      value={value}
      onValueChange={(v) => onChange(v ?? [])}
      items={options}
    >
      <SelectTrigger aria-label={allLabel} className="w-full">
        <SelectValue>
          {(v: V[] | null) => selectionSummary(v, options, allLabel)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={String(opt.value)} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
    <th className="border-border/50 bg-background border-b pb-1.5 font-normal whitespace-nowrap">
      <button
        type="button"
        title={title}
        onClick={() => onSort(sortKey)}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-0.5 transition-colors",
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
  const searchRef = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  // Restore the last session's filters + sort on mount (absent/corrupt → defaults).
  useEffect(() => {
    const saved = loadTableState();
    if (saved) {
      const { search: savedSearch, ...savedFacets } = saved.filters;
      setSearch(savedSearch);
      setFacets(savedFacets);
      setSort(saved.sort);
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <MagnifyingGlass
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              if (search) setSearch("");
              else e.currentTarget.blur();
            }}
            placeholder="Press F to search"
            aria-label="Search armor by name"
            className="pl-6"
          />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:flex xl:w-auto xl:*:w-40">
          <MultiFilterSelect
            allLabel="All classes"
            value={facets.classes}
            onChange={(v) => setFacet("classes", v)}
            options={[0, 1, 2].map((c) => ({ value: c, label: CLASS_NAMES[c] }))}
          />
          <MultiFilterSelect
            allLabel="All slots"
            value={facets.slots}
            onChange={(v) => setFacet("slots", v)}
            options={ARMOR_SLOTS.map((s) => ({ value: s, label: SLOT_LABELS[s] }))}
          />
          <MultiFilterSelect
            allLabel="All sets"
            value={facets.setHashes}
            onChange={(v) => setFacet("setHashes", v)}
            options={setOptions}
          />
          <MultiFilterSelect
            allLabel="All archetypes"
            value={facets.archetypes}
            onChange={(v) => setFacet("archetypes", v)}
            options={archetypeOptions}
          />
          <MultiFilterSelect<TuningFilter>
            allLabel="Any tuning"
            value={facets.tunings}
            onChange={(v) => setFacet("tunings", v)}
            options={[
              ...statOptions,
              { value: "none" as const, label: "Not tunable" },
            ]}
          />
          <MultiFilterSelect
            allLabel="Any tertiary"
            value={facets.tertiaries}
            onChange={(v) => setFacet("tertiaries", v)}
            options={statOptions}
          />
        </div>
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="tabular-nums">
          {filtered.length} of {rows.length} pieces
        </span>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={clearFilters}
          >
            <X aria-hidden />
            Clear filters
          </Button>
        )}
      </div>

      <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[78rem] table-fixed text-sm">
          {TABLE_COLGROUP}
          <thead className="bg-background sticky top-0 z-10">
            <tr className="text-muted-foreground text-left text-xs">
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
              <th className="border-border/50 bg-background border-b pb-1.5 text-left font-normal">
                Actions
              </th>
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
  );
}

const ArmorRow = memo(function ArmorRow({
  row,
  characters,
  onRefresh,
  dataIndex,
  measureRef,
}: {
  row: Row;
  characters: ArmoryCharacter[];
  onRefresh: () => void;
  dataIndex: number;
  measureRef: (el: HTMLTableRowElement | null) => void;
}) {
  const { piece } = row;
  return (
    <tr
      ref={measureRef}
      data-index={dataIndex}
      className="border-border/50 border-t"
    >
      <td className="overflow-hidden py-1.5 pr-3">
        <div className="flex items-center gap-2">
          {piece.icon ? (
            <Image
              src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
              alt=""
              width={24}
              height={24}
              className="shrink-0 rounded-sm"
            />
          ) : (
            <span className="bg-muted size-6 shrink-0 rounded-sm" aria-hidden />
          )}
          <span className="truncate font-medium">{piece.name}</span>
          {piece.isExotic && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              Exotic
            </Badge>
          )}
          {piece.isArtifice && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]">
              Artifice
            </Badge>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {CLASS_NAMES[piece.classType] ?? "—"}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">{SLOT_LABELS[piece.slot]}</td>
      <td className="truncate py-1.5 pr-3">{piece.archetype ?? "—"}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {row.tertiary !== undefined ? statLabel(row.tertiary) : "—"}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {piece.tunedStat !== undefined ? statLabel(piece.tunedStat) : "—"}
      </td>
      <td className="truncate py-1.5 pr-3">{row.setName ?? "—"}</td>
      {STAT_DISPLAY_ORDER.map((key) => (
        <td key={key} className="py-1.5 pr-3 text-right tabular-nums">
          {piece.stats[STAT_ORDER.indexOf(key)]}
        </td>
      ))}
      <td className="text-muted-foreground py-1.5 pr-3 whitespace-nowrap">
        {LOCATION_LABELS[piece.location]}
      </td>
      <td className="py-1.5">
        <ArmorRowActions
          piece={piece}
          characters={characters}
          onDone={onRefresh}
        />
      </td>
    </tr>
  );
});
