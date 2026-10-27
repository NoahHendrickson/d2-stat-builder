// Armor-table sorting: column key → comparable value, with missing values
// ("—") always last regardless of direction. Sort state is an ordered nest
// chain of direction or custom-order levels — compare walks until a tie breaks.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias,
// matching the convention in filters.ts / search.ts.
import {
  CLASS_NAMES,
  STAT_LABELS,
  STAT_ORDER,
} from "../armory/stats";
import type { PieceUsageCounts } from "../build-usage/buckets";
import {
  isCustomOrderColumn,
  sortLevelAsc,
  type ColumnKey,
  type CustomOrderColumn,
  type SortKey,
  type SortLevel,
  type SortState,
} from "./filters";

/**
 * One collator for every text comparison. `localeCompare` resolves locale data per
 * call; a sort over a full vault runs tens of thousands of comparisons per keystroke.
 */
const collator = new Intl.Collator();
/** STAT_ORDER index per `stat-<key>` sort key, so the comparator doesn't scan per call. */
const STAT_SORT_INDEX = new Map<SortKey, number>(
  STAT_ORDER.map((key, i) => [`stat-${key}` as const, i]),
);

const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Name",
  class: "Class",
  archetype: "Archetype",
  tertiary: "Tertiary",
  tuned: "Tuned",
  set: "Set bonus",
  builds: "Searches",
};

/** The column's header label ("Mobility", not "stat-mobility"). */
export function sortKeyLabel(key: SortKey): string {
  return isStatSortKey(key)
    ? STAT_LABELS[key.slice(5) as keyof typeof STAT_LABELS]
    : COLUMN_LABELS[key as ColumnKey];
}

/** Number columns default to descending (high rolls first); text columns to ascending. */
export const DESC_FIRST: ReadonlySet<SortKey> = new Set<SortKey>([
  ...STAT_ORDER.map((key) => `stat-${key}` as const),
  "builds",
]);

export function isStatSortKey(key: SortKey): boolean {
  return key.startsWith("stat-");
}

/** Columns that sort by number (menu reads "High to low", not "Z to A"). */
export function isNumericSortKey(key: SortKey): boolean {
  return DESC_FIRST.has(key);
}

/** Preferred direction for hover preview when the column is not in the chain. */
export function preferredAsc(key: SortKey): boolean {
  return !DESC_FIRST.has(key);
}

/** Sort-menu tab ids: alphabetical/numeric direction, or custom value order. */
export type SortMode = "asc" | "desc" | "custom";

/** A mode with what it needs: a custom order carries its value list. */
export type SortPick =
  | { mode: "asc" | "desc" }
  | { mode: "custom"; order: string[] };

/** The modes a column offers, preferred direction first. */
export function sortModesFor(key: SortKey): SortMode[] {
  const dirs: SortMode[] = preferredAsc(key) ? ["asc", "desc"] : ["desc", "asc"];
  return isCustomOrderColumn(key) ? [...dirs, "custom"] : dirs;
}

/** How a mode reads for this column: "A→Z", "High→Low", "Custom order". */
export function sortModeLabel(key: SortKey, mode: SortMode): string {
  if (mode === "custom") return "Custom order";
  if (isNumericSortKey(key)) return mode === "desc" ? "High→Low" : "Low→High";
  return mode === "asc" ? "A→Z" : "Z→A";
}

/** Result of applying a sort action — one atomic chain write (+ optional undo). */
export interface SortActionResult {
  sort: SortState;
  discardedChain?: SortState;
}

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
 * chain. Custom levels are self-describing (no parallel orders map).
 */
export function activeSortMode(
  sort: SortState,
  key: SortKey,
): SortMode | null {
  const level = sortLevelFor(sort, key);
  if (!level) return null;
  if (level.kind === "custom") return "custom";
  return level.asc ? "asc" : "desc";
}

function buildLevel(key: SortKey, pick: SortPick): SortLevel | null {
  if (pick.mode === "custom") {
    if (!isCustomOrderColumn(key)) return null;
    return { key, kind: "custom", order: pick.order };
  }
  return { key, kind: "dir", asc: pick.mode === "asc" };
}

/**
 * Apply a sort mode for `key`: replace the chain, append as a nest, or update
 * an existing level in place. Replacing a non-empty chain snapshots it for undo.
 */
export function applySortAction(
  sort: SortState,
  key: SortKey,
  pick: SortPick,
  nest = false,
): SortActionResult {
  const level = buildLevel(key, pick);
  if (!level) return { sort };

  const index = sortIndexOf(sort, key);
  if (index !== -1) {
    const next = [...sort];
    next[index] = level;
    return { sort: next };
  }
  if (nest && sort.length > 0) {
    return { sort: [...sort, level] };
  }
  return {
    sort: [level],
    discardedChain: sort.length > 0 ? sort : undefined,
  };
}

/** Remove one column from the nest chain; snapshots the prior chain for undo. */
export function clearSortLevel(
  sort: SortState,
  key: SortKey,
): SortActionResult {
  if (sortIndexOf(sort, key) === -1) return { sort };
  return {
    sort: sort.filter((level) => level.key !== key),
    discardedChain: sort,
  };
}

/** Move `key`'s level to the front of the chain (undoable). */
export function promoteSortLevel(
  sort: SortState,
  key: SortKey,
): SortActionResult {
  const index = sortIndexOf(sort, key);
  if (index <= 0) return { sort };
  return {
    sort: [sort[index], ...sort.slice(0, index), ...sort.slice(index + 1)],
    discardedChain: sort,
  };
}

/** Keep only `key`'s level, dropping the rest of the chain (undoable). */
export function soloSortLevel(
  sort: SortState,
  key: SortKey,
): SortActionResult {
  const level = sortLevelFor(sort, key);
  if (!level || sort.length === 1) return { sort };
  return { sort: [level], discardedChain: sort };
}

/**
 * Move a value inside a custom level (no-op if that level isn't custom). `values` is
 * the list as shown (applyCustomOrder): the saved order can hold values no piece has
 * any more and miss new ones, so the move is made on what was shown, which becomes
 * the order.
 */
export function reorderCustomLevel(
  sort: SortState,
  key: CustomOrderColumn,
  values: readonly string[],
  from: number,
  to: number,
): SortState {
  const index = sortIndexOf(sort, key);
  if (index === -1) return sort;
  const level = sort[index];
  if (level.kind !== "custom") return sort;
  const next = [...sort];
  next[index] = { ...level, order: moveOrderItem(values, from, to) };
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

/** Display label for a STAT_ORDER index. */
export const statLabel = (index: number) => STAT_LABELS[STAT_ORDER[index]];

/** The row fields the sort reads (structural subset of the table's Row). */
export interface SortableRow {
  piece: {
    name: string;
    classType: number;
    stats: readonly number[];
    archetype?: string;
    tunedStat?: number;
  };
  setName?: string;
  /** Tertiary archetype stat index — Armor 3.0 pieces only. */
  tertiary?: number;
  /** Optimizer usage history; absent until a recorded query included the piece. */
  usage?: PieceUsageCounts;
}

export function sortValue(
  row: SortableRow,
  key: SortKey,
): string | number | undefined {
  const statIndex = STAT_SORT_INDEX.get(key);
  if (statIndex !== undefined) return row.piece.stats[statIndex];
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
    case "builds":
      return row.usage?.eligible ? row.usage.used : undefined;
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
    order ? compareWithCustomOrder(a, b, order) : collator.compare(a, b),
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
  return collator.compare(a, b);
}

function compareOneLevel(
  a: SortableRow,
  b: SortableRow,
  level: SortLevel,
): number {
  const va = sortValue(a, level.key);
  const vb = sortValue(b, level.key);
  // Missing values ("—") always sort last, regardless of direction.
  if (va === undefined && vb === undefined) return 0;
  if (va === undefined) return 1;
  if (vb === undefined) return -1;
  const order = level.kind === "custom" ? level.order : undefined;
  const cmp = order
    ? compareWithCustomOrder(String(va), String(vb), order)
    : typeof va === "number" && typeof vb === "number"
      ? va - vb
      : collator.compare(String(va), String(vb));
  return sortLevelAsc(level) ? cmp : -cmp;
}

/** Walk the nest chain until a level breaks the tie. */
export function compareRows(
  a: SortableRow,
  b: SortableRow,
  sort: SortState,
): number {
  for (const level of sort) {
    const cmp = compareOneLevel(a, b, level);
    if (cmp !== 0) return cmp;
  }
  return 0;
}
