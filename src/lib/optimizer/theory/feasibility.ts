/**
 * Whether a build's armor sum can reach its targets, in closed form. Every Tier-5 stat
 * value is a multiple of 5, so the search works in those units.
 */
import { NUM_SLOTS, NUM_STATS } from "../floors";
import type { StatArray } from "../types";

export { clamp as clampStat, NUM_SLOTS, NUM_STATS, STAT_CAP } from "../floors";
/** Every Tier-5 stat value is a multiple of this. */
export const UNIT = 5;
/** A stat with no target: it can give away any number of units. */
export const FREE = -1_000_000;
/** One directional tuning per piece. */
export const MAX_TUNINGS = NUM_SLOTS;

/**
 * Directional tunings a build needs to reach its targets (≥ 0), or −(units it falls short
 * by) when it can't. `g[s]` is how many units stat s must gain (negative = units it can
 * give away; FREE = no target, any).
 *
 * Mods go where the need is: majors (2 units) on stats short by 2+, then majors on stats
 * short by 1, then minors. Whatever is still short (P units) has to be tuned in, one unit
 * per tuning, from a stat with room: at most 5, and no more than the room there is. The
 * room left after every mod is placed is P − Σh over the residuals h — unlimited when some
 * stat has no target. What tuning can't cover is the shortfall.
 */
export function tuningsNeeded(g: ArrayLike<number>, major: number, minor: number): number {
  let need = 0;
  let pairs = 0;
  let odd = 0;
  let sum = 0;
  let free = false;
  for (let s = 0; s < NUM_STATS; s++) {
    const v = g[s];
    if (v <= FREE) {
      free = true;
      continue;
    }
    sum += v;
    if (v > 0) {
      need += v;
      pairs += v >> 1;
      odd += v & 1;
    }
  }
  const short = Math.max(
    0,
    major <= pairs ? need - 2 * major - minor : odd - Math.min(major - pairs, odd) - minor,
  );
  const room = free ? Infinity : Math.max(0, short - (sum - 2 * major - minor));
  const miss = short - Math.min(short, MAX_TUNINGS, room);
  return miss > 0 ? -miss : short;
}

/** Units a stat must gain to reach its target from the armor (FREE without a target). */
export function unitsToGain(minimums: StatArray, constant: StatArray): number[] {
  return minimums.map((m, s) => (m > 0 ? Math.ceil((m - constant[s]) / UNIT) : FREE));
}
