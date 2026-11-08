// The gist of a theoretical build list: which archetypes the pieces to farm are most
// often, with the tertiaries and tuned stats each of them has, for the "What to farm" card.
//
// Runtime imports are relative (not `@/`), matching sort-loadouts.ts.
import { countBy } from "../count-by";
import { NUM_SLOTS } from "../optimizer/floors";
import type { TheoryPiece, TheoryRecipe } from "../optimizer/theory";

/** An archetype shows when at least this share of the farmed pieces are it (top 3). */
const ARCHETYPE_SHARE = 0.15;
const MAX_ARCHETYPES = 3;
/**
 * A tertiary shows when at least this share of an archetype's farmed pieces have it (top 2).
 * Above 1/4: an archetype has four possible tertiaries, so an even spread names none.
 */
const TERTIARY_SHARE = 0.3;
const MAX_TERTIARIES = 2;
/** Tuning is worth a mention when at least this share of an archetype's farmed pieces need one. */
const TUNED_SHARE = 0.3;
/** …and a tuned stat shows when at least this share of those pieces use it (top 2). */
const TUNED_STAT_SHARE = 0.3;
const MAX_TUNED = 2;
/**
 * Slots are named when at least this share of the list's builds use an owned legendary.
 * Low on purpose: the search fills most lists with builds that farm all five…
 */
const SLOT_BOUND_BUILDS = 0.15;
/** …and a slot when at least this share of those builds farm a piece for it. */
const SLOT_BUILDS = 0.6;

export interface TheoryArchetypeSummary {
  name: string;
  /** Its two main stats (stat indices). */
  primary: number;
  secondary: number;
  /** Its share of the farmed pieces (0–1). */
  share: number;
  /** Stat indices, most common first. Empty = none is common enough: any will do. */
  tertiaries: number[];
  /** Stat indices, most common first. Empty = its pieces need no particular one. */
  tuned: number[];
}

export interface TheorySummary {
  /** Most common first. */
  archetypes: TheoryArchetypeSummary[];
  /**
   * ARMOR_SLOTS indices in slot order. Not per archetype: farmed pieces are interchangeable
   * across a build's open slots. Empty = no particular slots stand out.
   */
  slots: number[];
  /** The required sets the farmed pieces come from. */
  setHashes: number[];
  /** Builds the summary is drawn from. */
  builds: number;
}

/**
 * The keys with at least `min` of `of`, most common first, at most `max`. `keepFirst`
 * shows the top one regardless, so there's always something to farm for; without it, a
 * tie at the cap names neither side rather than picking by insertion order.
 */
function ranked<K>(
  counts: Map<K, number>,
  of: number,
  min: number,
  max: number,
  keepFirst = false,
): { key: K; share: number }[] {
  const kept = [...counts]
    .map(([key, n]) => ({ key, share: n / of }))
    .sort((a, b) => b.share - a.share)
    .filter((x, i) => (keepFirst && i === 0) || x.share >= min);
  const top = kept.slice(0, max);
  if (!keepFirst) {
    while (top.length > 0 && kept[top.length]?.share === top[top.length - 1].share) top.pop();
  }
  return top;
}

/** A build's legendaries left to farm (owned pieces and the exotic aren't hunted). */
function farmedPieces(recipe: TheoryRecipe): TheoryPiece[] {
  return recipe.pieces.filter((piece) => !piece.owned && !piece.exotic);
}

function summarizeArchetype(pieces: TheoryPiece[], share: number): TheoryArchetypeSummary {
  const { archetype, primary, secondary } = pieces[0];
  const tuned = pieces.flatMap((piece) => (piece.tuning ? [piece.tuning.plus] : []));
  return {
    name: archetype,
    primary,
    secondary,
    share,
    tertiaries: ranked(
      countBy(pieces, (piece) => piece.tertiary),
      pieces.length,
      TERTIARY_SHARE,
      MAX_TERTIARIES,
    ).map((t) => t.key),
    tuned:
      tuned.length / pieces.length >= TUNED_SHARE
        ? ranked(countBy(tuned, (stat) => stat), tuned.length, TUNED_STAT_SHARE, MAX_TUNED, true).map(
            (t) => t.key,
          )
        : [],
  };
}

/**
 * The slots most builds leave to farm. Only builds with an owned legendary seated say
 * anything about that: without one, every slot is open. Reads the farmed pieces rather
 * than `openSlots`, which still lists an unowned exotic's slot.
 */
function slotsToFarm(recipes: readonly TheoryRecipe[]): number[] {
  const bound = recipes.filter(
    (recipe) =>
      recipe.pieces.some((piece) => piece.owned && !piece.exotic) && farmedPieces(recipe).length > 0,
  );
  if (bound.length < recipes.length * SLOT_BOUND_BUILDS) return [];
  const slots = ranked(
    countBy(bound.flatMap(farmedPieces), (piece) => piece.slot),
    bound.length,
    SLOT_BUILDS,
    NUM_SLOTS,
  ).map((s) => s.key);
  return slots.length < NUM_SLOTS ? slots.sort((a, b) => a - b) : [];
}

/** Summarize the legendaries `recipes` would have you farm. Null when there's nothing to farm. */
export function summarizeTheory(recipes: readonly TheoryRecipe[]): TheorySummary | null {
  const farmed = recipes.flatMap(farmedPieces);
  if (farmed.length === 0) return null;
  return {
    archetypes: ranked(
      countBy(farmed, (piece) => piece.archetype),
      farmed.length,
      ARCHETYPE_SHARE,
      MAX_ARCHETYPES,
      true,
    ).map(({ key, share }) =>
      summarizeArchetype(
        farmed.filter((piece) => piece.archetype === key),
        share,
      ),
    ),
    slots: slotsToFarm(recipes),
    setHashes: [...new Set(farmed.flatMap((piece) => piece.setHash ?? []))],
    builds: recipes.length,
  };
}
