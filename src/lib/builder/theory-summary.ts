// The gist of a theoretical build list: which archetypes, tertiaries and tuned stats
// the pieces to farm have most often, for a one-line "what to farm" summary.
//
// Runtime imports are relative (not `@/`), matching sort-loadouts.ts.
import type { TheoryRecipe } from "../optimizer/theory";

/** An archetype shows when at least this share of the farmed pieces are it (top 3). */
const ARCHETYPE_SHARE = 0.15;
const MAX_ARCHETYPES = 3;
/** A tertiary shows when at least this share of the farmed pieces have it (top 2). */
const TERTIARY_SHARE = 0.25;
const MAX_TERTIARIES = 2;
/** Tuning is worth a mention when at least this share of the farmed pieces need one. */
const TUNED_SHARE = 0.3;
/** …and a tuned stat shows when at least this share of those pieces use it (top 2). */
const TUNED_STAT_SHARE = 0.3;
const MAX_TUNED = 2;

export interface TheorySummary {
  /** Most common first, each with its share of the farmed pieces (0–1). */
  archetypes: { name: string; share: number }[];
  /** Stat indices, most common first. Empty = none is common enough: any will do. */
  tertiaries: number[];
  /** Stat indices, most common first. null = most farmed pieces need no particular one. */
  tuned: number[] | null;
  /** The required sets the farmed pieces come from. */
  setHashes: number[];
  /** Builds the summary is drawn from. */
  builds: number;
}

/**
 * The keys with at least `min` of `of`, most common first, at most `max`. `keepFirst`
 * shows the top one regardless, so there's always something to farm for.
 */
function ranked<K>(
  counts: Map<K, number>,
  of: number,
  min: number,
  max: number,
  keepFirst = false,
): { key: K; share: number }[] {
  return [...counts]
    .map(([key, n]) => ({ key, share: n / of }))
    .sort((a, b) => b.share - a.share)
    .filter((x, i) => (keepFirst && i === 0) || x.share >= min)
    .slice(0, max);
}

/**
 * Summarize the legendaries `recipes` would have you farm (owned pieces and the exotic
 * are left out: they're not what you'd be hunting). Null when there's nothing to farm.
 */
export function summarizeTheory(recipes: readonly TheoryRecipe[]): TheorySummary | null {
  const archetypes = new Map<string, number>();
  const tertiaries = new Map<number, number>();
  const tuned = new Map<number, number>();
  const sets = new Set<number>();
  let pieces = 0;
  let tunedPieces = 0;
  for (const recipe of recipes) {
    for (const piece of recipe.pieces) {
      if (piece.owned || piece.exotic) continue;
      pieces++;
      archetypes.set(piece.archetype, (archetypes.get(piece.archetype) ?? 0) + 1);
      tertiaries.set(piece.tertiary, (tertiaries.get(piece.tertiary) ?? 0) + 1);
      if (piece.tuning) {
        tunedPieces++;
        tuned.set(piece.tuning.plus, (tuned.get(piece.tuning.plus) ?? 0) + 1);
      }
      if (piece.setHash !== undefined) sets.add(piece.setHash);
    }
  }
  if (pieces === 0) return null;
  return {
    archetypes: ranked(archetypes, pieces, ARCHETYPE_SHARE, MAX_ARCHETYPES, true).map(
      ({ key, share }) => ({ name: key, share }),
    ),
    tertiaries: ranked(tertiaries, pieces, TERTIARY_SHARE, MAX_TERTIARIES).map((t) => t.key),
    tuned:
      tunedPieces / pieces >= TUNED_SHARE
        ? ranked(tuned, tunedPieces, TUNED_STAT_SHARE, MAX_TUNED, true).map((t) => t.key)
        : null,
    setHashes: [...sets],
    builds: recipes.length,
  };
}
