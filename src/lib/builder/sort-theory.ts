// Client-side sort for theoretical builds. The solver's order is the best match (most
// owned pieces, then fewest tuned, then highest total); a stat sort brings up the builds
// that put their spare points into that stat.
//
// Runtime imports are relative (not `@/`), matching sort-loadouts.ts.
import { STAT_DISPLAY_ORDER, STAT_LABELS, STAT_ORDER, type StatKey } from "../armory/stats";
import type { TheoryRecipe } from "../optimizer/theory";

export type TheorySortKey = "best" | StatKey;

export type TheorySortState = { key: TheorySortKey; asc: boolean };

export const DEFAULT_THEORY_SORT: TheorySortState = { key: "best", asc: false };

export const THEORY_SORT_OPTIONS: readonly { key: TheorySortKey; label: string }[] = [
  { key: "best", label: "Best match" },
  ...STAT_DISPLAY_ORDER.map((key) => ({ key, label: STAT_LABELS[key] })),
];

/** Stable: ties keep the solver's order. "Best match" is that order (low to high reverses it). */
export function sortTheoryRecipes(
  recipes: readonly TheoryRecipe[],
  sort: TheorySortState,
): TheoryRecipe[] {
  const value = (r: TheoryRecipe, index: number) =>
    sort.key === "best" ? -index : r.stats[STAT_ORDER.indexOf(sort.key)];
  return recipes
    .map((recipe, index) => ({ recipe, index }))
    .sort((a, b) => {
      const av = value(a.recipe, a.index);
      const bv = value(b.recipe, b.index);
      if (av === bv) return a.index - b.index;
      return sort.asc ? av - bv : bv - av;
    })
    .map((entry) => entry.recipe);
}
