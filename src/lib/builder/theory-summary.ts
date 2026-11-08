// The gist of a theoretical build list: which archetypes the pieces to farm are most
// often, with the tertiaries and tuned stats each of them has, for the "What to farm" card.
//
// Runtime imports are relative (not `@/`), matching sort-loadouts.ts.
import type { TheoryRecipe } from "../optimizer/theory";

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
/** A slot shows when at least this share of an archetype's slot-bound pieces go in it (top 3). */
const SLOT_SHARE = 0.3;
const MAX_SLOTS = 3;

export interface TheoryArchetypeSummary {
  name: string;
  /** Its two main stats (stat indices). */
  primary: number;
  secondary: number;
  /** Its share of the farmed pieces (0–1). */
  share: number;
  /** Stat indices, most common first. Empty = none is common enough: any will do. */
  tertiaries: number[];
  /** Stat indices, most common first. null = most of its pieces need no particular one. */
  tuned: number[] | null;
  /**
   * In slot order, counted from builds with an owned legendary seated: only those leave
   * particular slots to farm. Empty = no slot stands out.
   */
  slots: TheorySlotSummary[];
}

export interface TheorySlotSummary {
  /** ARMOR_SLOTS index. */
  slot: number;
  /** The set most of its pieces come from, if they come from one. */
  setHash?: number;
}

export interface TheorySummary {
  /** Most common first. */
  archetypes: TheoryArchetypeSummary[];
  /** The required sets the farmed pieces come from. */
  setHashes: number[];
  /** Builds the summary is drawn from. */
  builds: number;
}

/** One archetype's farmed pieces, counted up. */
interface ArchetypeTally {
  primary: number;
  secondary: number;
  pieces: number;
  tertiaries: Map<number, number>;
  tunedPieces: number;
  tuned: Map<number, number>;
  slotPieces: number;
  slots: Map<number, number>;
  /** Per slot, how many of its pieces are from each set (undefined = none). */
  slotSets: Map<number, Map<number | undefined, number>>;
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
  const tallies = new Map<string, ArchetypeTally>();
  const sets = new Set<number>();
  let pieces = 0;
  for (const recipe of recipes) {
    const slotBound = recipe.pieces.some((piece) => piece.owned && !piece.exotic);
    for (const piece of recipe.pieces) {
      if (piece.owned || piece.exotic) continue;
      pieces++;
      let tally = tallies.get(piece.archetype);
      if (!tally) {
        tally = {
          primary: piece.primary,
          secondary: piece.secondary,
          pieces: 0,
          tertiaries: new Map(),
          tunedPieces: 0,
          tuned: new Map(),
          slotPieces: 0,
          slots: new Map(),
          slotSets: new Map(),
        };
        tallies.set(piece.archetype, tally);
      }
      tally.pieces++;
      if (slotBound) {
        tally.slotPieces++;
        tally.slots.set(piece.slot, (tally.slots.get(piece.slot) ?? 0) + 1);
        const slotSets = tally.slotSets.get(piece.slot) ?? new Map<number | undefined, number>();
        slotSets.set(piece.setHash, (slotSets.get(piece.setHash) ?? 0) + 1);
        tally.slotSets.set(piece.slot, slotSets);
      }
      tally.tertiaries.set(piece.tertiary, (tally.tertiaries.get(piece.tertiary) ?? 0) + 1);
      if (piece.tuning) {
        tally.tunedPieces++;
        tally.tuned.set(piece.tuning.plus, (tally.tuned.get(piece.tuning.plus) ?? 0) + 1);
      }
      if (piece.setHash !== undefined) sets.add(piece.setHash);
    }
  }
  if (pieces === 0) return null;
  const counts = new Map([...tallies].map(([name, tally]) => [name, tally.pieces]));
  return {
    archetypes: ranked(counts, pieces, ARCHETYPE_SHARE, MAX_ARCHETYPES, true).map(({ key, share }) => {
      const tally = tallies.get(key)!;
      return {
        name: key,
        primary: tally.primary,
        secondary: tally.secondary,
        share,
        tertiaries: ranked(tally.tertiaries, tally.pieces, TERTIARY_SHARE, MAX_TERTIARIES).map((t) => t.key),
        tuned:
          tally.tunedPieces / tally.pieces >= TUNED_SHARE
            ? ranked(tally.tuned, tally.tunedPieces, TUNED_STAT_SHARE, MAX_TUNED, true).map((t) => t.key)
            : null,
        slots: ranked(tally.slots, tally.slotPieces, SLOT_SHARE, MAX_SLOTS)
          .map(({ key: slot }) => ({
            slot,
            setHash: ranked(tally.slotSets.get(slot)!, 1, 0, 1)[0].key,
          }))
          .sort((a, b) => a.slot - b.slot),
      };
    }),
    setHashes: [...sets],
    builds: recipes.length,
  };
}
