// Armor-table sorting: column key → comparable value, with missing values
// ("—") always last regardless of direction.
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
import type { ColumnKey, SortKey, SortState } from "./filters";

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

export function compareRows(
  a: SortableRow,
  b: SortableRow,
  sort: SortState,
): number {
  const va = sortValue(a, sort.key);
  const vb = sortValue(b, sort.key);
  // Missing values ("—") always sort last, regardless of direction.
  if (va === undefined && vb === undefined) return 0;
  if (va === undefined) return 1;
  if (vb === undefined) return -1;
  const cmp =
    typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb));
  return sort.asc ? cmp : -cmp;
}

/** Stat columns default to descending (high rolls first); text columns to ascending. */
export const DESC_FIRST: ReadonlySet<SortKey> = new Set<SortKey>(
  STAT_ORDER.map((key) => `stat-${key}` as const),
);
