"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CUSTOM_ORDER_COLUMNS,
  DEFAULT_SORT,
  isCustomOrderColumn,
  type CustomOrderColumn,
  type SortKey,
  type SortState,
} from "@/lib/armor-table/filters";
import {
  applyCustomOrder,
  applySortAction,
  clearSortLevel,
  compareRows,
  moveSortLevel,
  reorderCustomLevel,
  soloSortLevel,
  sortValue,
  type SortActionResult,
  type SortMode,
  type SortableRow,
} from "@/lib/armor-table/sort";
import { loadTableState } from "@/lib/armor-table/filter-storage";

/** Everything the column menus can do to the chain. */
export interface SortActions {
  applyMode: (
    key: SortKey,
    mode: SortMode,
    nest: boolean,
    order?: string[],
  ) => void;
  clearLevel: (key: SortKey) => void;
  soloLevel: (key: SortKey) => void;
  moveLevel: (from: number, to: number) => void;
  reorderCustom: (key: CustomOrderColumn, from: number, to: number) => void;
  undoSort: () => void;
}

/**
 * Owns armor-table sort chain, undo stack, and distinct custom-order values.
 * Persistence stays in ArmorTable (one localStorage write with filters).
 */
export function useArmorTableSort(rows: SortableRow[]) {
  // Restore synchronously so the first persist write cannot clobber storage.
  const [sort, setSort] = useState<SortState>(
    () => loadTableState()?.sort ?? DEFAULT_SORT,
  );
  const [sortUndo, setSortUndo] = useState<SortState | null>(null);

  const applyResult = useCallback((result: SortActionResult) => {
    if (result.discardedChain && result.discardedChain.length > 0) {
      setSortUndo(result.discardedChain);
    } else {
      setSortUndo(null);
    }
    setSort(result.sort);
  }, []);

  const applyMode = useCallback(
    (key: SortKey, mode: SortMode, nest: boolean, order?: string[]) => {
      applyResult(applySortAction(sort, key, mode, nest, order));
    },
    [applyResult, sort],
  );

  const clearLevel = useCallback(
    (key: SortKey) => {
      applyResult(clearSortLevel(sort, key));
    },
    [applyResult, sort],
  );

  const soloLevel = useCallback(
    (key: SortKey) => {
      applyResult(soloSortLevel(sort, key));
    },
    [applyResult, sort],
  );

  // Reordering keeps every level, so there's nothing to undo.
  const moveLevel = useCallback((from: number, to: number) => {
    setSort((prev) => moveSortLevel(prev, from, to));
    setSortUndo(null);
  }, []);

  const reorderCustom = useCallback(
    (key: CustomOrderColumn, from: number, to: number) => {
      setSort((prev) => reorderCustomLevel(prev, key, from, to));
      setSortUndo(null);
    },
    [],
  );

  const undoSort = useCallback(() => {
    setSortUndo((prev) => {
      if (prev) setSort(prev);
      return null;
    });
  }, []);

  // Distinct values per custom-orderable column, in effective sort order.
  const orderedColumnValues = useMemo(() => {
    const distinct: Record<CustomOrderColumn, Set<string>> = {
      class: new Set(),
      archetype: new Set(),
      tertiary: new Set(),
      tuned: new Set(),
      set: new Set(),
    };
    for (const r of rows) {
      for (const col of CUSTOM_ORDER_COLUMNS) {
        const v = sortValue(r, col);
        if (typeof v === "string") distinct[col].add(v);
      }
    }
    const out = {} as Record<CustomOrderColumn, string[]>;
    for (const col of CUSTOM_ORDER_COLUMNS) {
      const level = sort.find((l) => l.key === col);
      const order = level?.kind === "custom" ? level.order : undefined;
      out[col] = applyCustomOrder([...distinct[col]], order);
    }
    return out;
  }, [rows, sort]);

  const sortRows = useCallback(
    <T extends SortableRow>(matches: T[]): T[] => {
      if (sort.length === 0) return matches;
      return matches.sort((a, b) => compareRows(a, b, sort));
    },
    [sort],
  );

  const columnValues = useCallback(
    (key: SortKey): string[] | undefined =>
      isCustomOrderColumn(key) ? orderedColumnValues[key] : undefined,
    [orderedColumnValues],
  );

  const actions = useMemo<SortActions>(
    () => ({
      applyMode,
      clearLevel,
      soloLevel,
      moveLevel,
      reorderCustom,
      undoSort,
    }),
    [applyMode, clearLevel, soloLevel, moveLevel, reorderCustom, undoSort],
  );

  return { sort, sortUndo, actions, sortRows, columnValues };
}
