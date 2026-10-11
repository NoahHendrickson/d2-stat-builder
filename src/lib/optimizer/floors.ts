/**
 * Leaf module: the tiny shared stat constants plus the `raiseAchievableFloors` primitive.
 *
 * This exists so the main-thread carry logic (carryover.ts) can reach `raiseAchievableFloors`
 * and `NUM_STATS` WITHOUT transitively pulling in the ~1300-line solver (solve.ts) or the
 * tuning searcher (tuning.ts). Keep this module dependency-free at runtime (type-only imports
 * are fine) so it stays a genuine leaf. tuning.ts and solve.ts import these back out of here.
 */
import type { ModBudget } from "./types";

export const NUM_STATS = 6;
export const NUM_SLOTS = 5;
export const STAT_CAP = 200;

export const clamp = (v: number): number =>
  v < 0 ? 0 : v > STAT_CAP ? STAT_CAP : v;

/**
 * Raise each of `floors` to what a single real build proves is achievable for that stat:
 * the build's final `stats[s]` PLUS its spare mod capacity (every mod point not consumed
 * by the build) dumped into that ONE stat, clamped to STAT_CAP. Mutates `floors` in place;
 * returns whether any floor rose.
 *
 * Why every raised value is achievable: the build already meets the query's minimums, and
 * mods are only auto-assigned to cover deficits — so its unspent capacity could genuinely
 * be re-socketed into any single stat while the other five keep their achieved values
 * (still ≥ their minimums). This is the shared primitive behind both the top-N seed dump
 * and the ceiling witness harvest.
 *
 * A stat the build shows at 0 gets no spare: the final stats are clamped, so a 0 may hide
 * a value BELOW zero (negative fragments, a −5 tune), and the spare mods would first have
 * to climb back to 0 — e.g. −10 plus one spare major is still 0, not 10. The true value
 * isn't recoverable from the clamped stats, so the floor stays at the proven 0. (Feasible-mode witnesses don't dump leftover artifice
 * +3s, so a harvested value can slightly UNDER-state the true max — it stays a valid lower
 * bound, never an over-report.)
 */
export function raiseAchievableFloors(
  floors: number[],
  stats: number[],
  modsUsed: { major: number; minor: number },
  mods: ModBudget,
): boolean {
  const spare =
    (mods.major - modsUsed.major) * 10 + (mods.minor - modsUsed.minor) * 5;
  let rose = false;
  for (let s = 0; s < NUM_STATS; s++) {
    const v = stats[s] > 0 ? clamp(stats[s] + spare) : 0;
    if (v > floors[s]) {
      floors[s] = v;
      rose = true;
    }
  }
  return rose;
}
