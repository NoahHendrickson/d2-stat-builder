// Armor-table sorting: column key → comparable value, with missing values
// ("—") always last regardless of direction. Sort state is an ordered nest
// chain — compare walks levels until a tie breaks.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias,
// matching the convention in filters.ts / search.ts.
import {
  CLASS_NAMES,
  STAT_LABELS,
  STAT_ORDER,
  type ArmorSlot,
  type StatKey,
} from "../armory/stats";
import type { ArmorLocation } from "../armory/normalize";
import {
  isCustomOrderColumn,
  type ColumnKey,
  type CustomOrderColumn,
  type CustomOrders,
  type SortKey,
  type SortLevel,
  type SortState,
} from "./filters";

/** Stat columns default to descending (high rolls first); text columns to ascending. */
export const DESC_FIRST: ReadonlySet<SortKey> = new Set<SortKey>(
  STAT_ORDER.map((key) => `stat-${key}` as const),
);

export function isStatSortKey(key: SortKey): boolean {
  return key.startsWith("stat-");
}

/** Preferred direction for hover preview when the column is not in the chain. */
export function preferredAsc(key: SortKey): boolean {
  return !DESC_FIRST.has(key);
}

/** Sort-menu tab ids: alphabetical/numeric direction, or custom value order. */
export type SortMode = "asc" | "desc" | "custom";

/** Index of `key` in the nest chain, or -1 when absent. */
export function sortIndexOf(sort: SortState, key: SortKey): number {
  return sort.findIndex((level) => level.key === key);
}

/** The nest level for `key`, or undefined when that column is not sorting. */
export function sortLevelFor(
  sort: SortState,
  key: SortKey,
): SortLevel | undefined {
  return sort.find((level) => level.key === key);
}

/**
 * Which menu tab is active for `key`, or `null` when that column is not in the
 * chain. A stored custom order wins over asc/desc for that level.
 */
export function activeSortMode(
  sort: SortState,
  key: SortKey,
  customOrders?: CustomOrders,
): SortMode | null {
  const level = sortLevelFor(sort, key);
  if (!level) return null;
  if (isCustomOrderColumn(key) && customOrders?.[key] !== undefined) {
    return "custom";
  }
  return level.asc ? "asc" : "desc";
}

/**
 * Apply a sort mode for `key`: replace the chain, append as a nest, or update
 * an existing level in place. `nest` is ignored when the column is already in
 * the chain or the chain is empty.
 */
export function applySortLevel(
  sort: SortState,
  key: SortKey,
  mode: SortMode,
  nest: boolean,
): SortState {
  const asc = mode !== "desc";
  const level: SortLevel = { key, asc };
  const index = sortIndexOf(sort, key);
  if (index !== -1) {
    const next = [...sort];
    next[index] = level;
    return next;
  }
  if (nest && sort.length > 0) return [...sort, level];
  return [level];
}

/** Remove one column from the nest chain (later levels keep their order). */
export function removeSortLevel(sort: SortState, key: SortKey): SortState {
  return sort.filter((level) => level.key !== key);
}

/** Drop a column's custom order entry (no-op when already absent). */
export function clearCustomOrder(
  orders: CustomOrders,
  col: CustomOrderColumn,
): CustomOrders {
  if (orders[col] === undefined) return orders;
  const next = { ...orders };
  delete next[col];
  return next;
}

/** Move `from` to `to` in a custom-order list (used by drag-and-drop / up-down). */
export function moveOrderItem(
  order: readonly string[],
  from: number,
  to: number,
): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= order.length ||
    to >= order.length
  ) {
    return [...order];
  }
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export const LOCATION_LABELS: Record<ArmorLocation, string> = {
  equipped: "Equipped",
  inventory: "Inventory",
  vault: "Vault",
};

/** Display label for a STAT_ORDER index. */
export const statLabel = (index: number) => STAT_LABELS[STAT_ORDER[index]];

/** The row fields the sort reads (structural subset of the table's Row). */
export interface SortableRow {
  piece: {
    name: string;
    classType: number;
    slot: ArmorSlot;
    location: ArmorLocation;
    stats: readonly number[];
    archetype?: string;
    tunedStat?: number;
  };
  setName?: string;
  /** Tertiary archetype stat index — Armor 3.0 pieces only. */
  tertiary?: number;
}

export function sortValue(
  row: SortableRow,
  key: SortKey,
): string | number | undefined {
  if (key.startsWith("stat-")) {
    const statKey = key.slice("stat-".length) as StatKey;
    return row.piece.stats[STAT_ORDER.indexOf(statKey)];
  }
  switch (key as ColumnKey) {
    case "name":
      return row.piece.name;
    case "class":
      return CLASS_NAMES[row.piece.classType];
    case "archetype":
      return row.piece.archetype;
    case "tertiary":
      return row.tertiary !== undefined ? statLabel(row.tertiary) : undefined;
    case "tuned":
      return row.piece.tunedStat !== undefined
        ? statLabel(row.piece.tunedStat)
        : undefined;
    case "set":
      return row.setName;
    default: {
      const exhaustive: never = key as never;
      return exhaustive;
    }
  }
}

/**
 * A column's values in ascending display order: alphabetical, or by the
 * custom order when one is set (the order-menu list and the table agree).
 */
export function applyCustomOrder(
  values: readonly string[],
  order: string[] | undefined,
): string[] {
  return [...values].sort((a, b) =>
    order ? compareWithCustomOrder(a, b, order) : a.localeCompare(b),
  );
}

/**
 * Compare two values under a custom order list: listed values by list index,
 * listed before unlisted, unlisted alphabetically among themselves.
 */
function compareWithCustomOrder(a: string, b: string, order: string[]): number {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

function compareOneLevel(
  a: SortableRow,
  b: SortableRow,
  level: SortLevel,
  customOrders?: CustomOrders,
): number {
  const va = sortValue(a, level.key);
  const vb = sortValue(b, level.key);
  // Missing values ("—") always sort last, regardless of direction.
  if (va === undefined && vb === undefined) return 0;
  if (va === undefined) return 1;
  if (vb === undefined) return -1;
  const order = isCustomOrderColumn(level.key)
    ? customOrders?.[level.key]
    : undefined;
  const cmp = order
    ? compareWithCustomOrder(String(va), String(vb), order)
    : typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb));
  return level.asc ? cmp : -cmp;
}

/** Walk the nest chain until a level breaks the tie. */
export function compareRows(
  a: SortableRow,
  b: SortableRow,
  sort: SortState,
  customOrders?: CustomOrders,
): number {
  for (const level of sort) {
    const cmp = compareOneLevel(a, b, level, customOrders);
    if (cmp !== 0) return cmp;
  }
  return 0;
}
