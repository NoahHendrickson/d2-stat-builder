// Client-side sort for optimizer result lists. The solver already ranks by
// total; this reorders the returned loadouts for display without re-running.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias,
// matching the convention in armor-table/filters.ts.
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatKey,
} from "../armory/stats";
import type { OptimizerLoadout } from "../optimizer/types";

/**
 * Sort by overall total, one of the six final stats, or what it costs to finish
 * masterworking the pieces (see masterwork.ts — informational, never a solver input).
 */
export type LoadoutSortKey = "total" | StatKey | "cost";

export type LoadoutSortState = {
  key: LoadoutSortKey;
  /** true = low→high; false = high→low (the usual default for stats). */
  asc: boolean;
};

export const DEFAULT_LOADOUT_SORT: LoadoutSortState = {
  key: "total",
  asc: false,
};

/** Menu options in UI display order, with Total first (solver default) and cost last. */
export const LOADOUT_SORT_OPTIONS: readonly {
  key: LoadoutSortKey;
  label: string;
}[] = [
  { key: "total", label: "Total" },
  ...STAT_DISPLAY_ORDER.map((key) => ({
    key,
    label: STAT_LABELS[key],
  })),
  { key: "cost", label: "Upgrade cost" },
];

export function loadoutSortLabel(key: LoadoutSortKey): string {
  if (key === "total") return "Total";
  if (key === "cost") return "Upgrade cost";
  return STAT_LABELS[key];
}

/** A build's masterwork-cost score (see materialScore in masterwork.ts). Null = unknown. */
export type LoadoutCostFn = (loadout: OptimizerLoadout) => number | null;

function sortValue(
  loadout: OptimizerLoadout,
  key: LoadoutSortKey,
  cost: LoadoutCostFn | undefined,
): number | null {
  if (key === "total") return loadout.total;
  if (key === "cost") return cost?.(loadout) ?? null;
  return loadout.stats[STAT_ORDER.indexOf(key)];
}

/**
 * Stable sort of loadouts by the chosen key/direction. Ties keep the solver's
 * relative order (already total-desc), so switching sort doesn't reshuffle equals.
 * `cost` supplies the "cost" key's value; without it every build is unknown (nulls
 * pin to the end, so the solver order is kept). Unknown costs always sort last,
 * regardless of direction — same as OptimizerLoadout.power.
 */
export function sortLoadouts(
  loadouts: readonly OptimizerLoadout[],
  sort: LoadoutSortState,
  cost?: LoadoutCostFn,
): OptimizerLoadout[] {
  const indexed = loadouts.map((loadout, index) => ({ loadout, index }));
  indexed.sort((a, b) => {
    const av = sortValue(a.loadout, sort.key, cost);
    const bv = sortValue(b.loadout, sort.key, cost);
    if (av === bv) return a.index - b.index;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sort.asc ? av - bv : bv - av;
  });
  return indexed.map((entry) => entry.loadout);
}
