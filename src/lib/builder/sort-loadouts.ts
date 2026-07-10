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

/** Sort by overall total, or by one of the six final stats. */
export type LoadoutSortKey = "total" | StatKey;

export type LoadoutSortState = {
  key: LoadoutSortKey;
  /** true = low→high; false = high→low (the usual default for stats). */
  asc: boolean;
};

export const DEFAULT_LOADOUT_SORT: LoadoutSortState = {
  key: "total",
  asc: false,
};

/** Menu options in UI display order, with Total first (solver default). */
export const LOADOUT_SORT_OPTIONS: readonly {
  key: LoadoutSortKey;
  label: string;
}[] = [
  { key: "total", label: "Total" },
  ...STAT_DISPLAY_ORDER.map((key) => ({
    key,
    label: STAT_LABELS[key],
  })),
];

export function loadoutSortLabel(key: LoadoutSortKey): string {
  if (key === "total") return "Total";
  return STAT_LABELS[key];
}

function sortValue(loadout: OptimizerLoadout, key: LoadoutSortKey): number {
  if (key === "total") return loadout.total;
  return loadout.stats[STAT_ORDER.indexOf(key)];
}

/**
 * Stable sort of loadouts by the chosen key/direction. Ties keep the solver's
 * relative order (already total-desc), so switching sort doesn't reshuffle equals.
 */
export function sortLoadouts(
  loadouts: readonly OptimizerLoadout[],
  sort: LoadoutSortState,
): OptimizerLoadout[] {
  const indexed = loadouts.map((loadout, index) => ({ loadout, index }));
  indexed.sort((a, b) => {
    const av = sortValue(a.loadout, sort.key);
    const bv = sortValue(b.loadout, sort.key);
    if (av !== bv) return sort.asc ? av - bv : bv - av;
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.loadout);
}
