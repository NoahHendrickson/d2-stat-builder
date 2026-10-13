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
  archetypes: { name: string; primary: number; secondary: number; share: number }[];
  /** Empty = no tertiary is common enough: any will do. */
  tertiaries: { stat: number; share: number }[];
  /** null = most farmed pieces need no particular tuned stat. */
  tuned: { stat: number; share: number }[] | null;
  /** The required sets the farmed pieces come from. */
  setHashes: number[];
  /** Builds and farmed legendaries the summary is drawn from. */
  builds: number;
  pieces: number;
}

/**
 * Summarize the legendaries `recipes` would have you farm (owned pieces and the exotic
 * are left out: they're not what you'd be hunting). Null when there's nothing to farm.
 */
export function summarizeTheory(recipes: readonly TheoryRecipe[]): TheorySummary | null {
  const archetypes = new Map<string, { name: string; primary: number; secondary: number; n: number }>();
  const tertiaries = new Map<number, number>();
  const tuned = new Map<number, number>();
  const sets = new Set<number>();
  let pieces = 0;
  let tunedPieces = 0;
  for (const recipe of recipes) {
    for (const piece of recipe.pieces) {
      if (piece.owned || piece.exotic) continue;
      pieces++;
      const a = archetypes.get(piece.archetype) ?? {
        name: piece.archetype,
        primary: piece.primary,
        secondary: piece.secondary,
        n: 0,
      };
      a.n++;
      archetypes.set(piece.archetype, a);
      tertiaries.set(piece.tertiary, (tertiaries.get(piece.tertiary) ?? 0) + 1);
      if (piece.tuning) {
        tunedPieces++;
        tuned.set(piece.tuning.plus, (tuned.get(piece.tuning.plus) ?? 0) + 1);
      }
      if (piece.setHash !== undefined) sets.add(piece.setHash);
    }
  }
  if (pieces === 0) return null;

  // Most common first; the first always shows, so there's something to farm for.
  const top = <T extends { share: number }>(list: T[], min: number, max: number): T[] =>
    list
      .sort((a, b) => b.share - a.share)
      .filter((x, i) => i === 0 || x.share >= min)
      .slice(0, max);
  return {
    archetypes: top(
      [...archetypes.values()].map(({ n, ...a }) => ({ ...a, share: n / pieces })),
      ARCHETYPE_SHARE,
      MAX_ARCHETYPES,
    ),
    tertiaries: top(
      [...tertiaries].map(([stat, n]) => ({ stat, share: n / pieces })),
      TERTIARY_SHARE,
      MAX_TERTIARIES,
    ).filter((t) => t.share >= TERTIARY_SHARE),
    tuned:
      tunedPieces / pieces >= TUNED_SHARE
        ? top(
            [...tuned].map(([stat, n]) => ({ stat, share: n / tunedPieces })),
            TUNED_STAT_SHARE,
            MAX_TUNED,
          )
        : null,
    setHashes: [...sets],
    builds: recipes.length,
    pieces,
  };
}
