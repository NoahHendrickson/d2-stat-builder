/**
 * The power-range constraint: a loadout's GEAR POWER — the floor of the mean power of
 * its pieces plus the weapons it will be equipped with, the way the game averages
 * equipped gear — must land inside an inclusive [min, max]. Shared by the top-N build
 * search and the ceiling probes so the two walks can't drift apart (the same "one
 * bound, encoded once" rule as makeJointMinCheck).
 *
 * Pieces with no known power (theoretical rolls with no live instance) are left OUT of
 * the mean rather than dragging it to 0: a loadout made only of such pieces, with no
 * weapons given, has a null power and passes any range. The weapons are fixed items
 * the walk never chooses, so they simply pre-load the running sums.
 *
 * Arithmetic, for a loadout whose n known-power items sum to S:
 *   floor(S/n) ≥ min  ⇔  S ≥ min·n          ⇔  Σ (p − min)        ≥ 0
 *   floor(S/n) ≤ max  ⇔  S < (max+1)·n      ⇔  Σ ((max+1) − p)    ≥ 1
 * Both sums run over known pieces only (an unknown piece contributes 0 to each), so each
 * is a per-piece additive quantity the walk can track as a running "slack" and bound
 * with a per-slot suffix maximum — an admissible prune, exact at the leaf.
 */
import { NUM_SLOTS } from "./floors";
import type { InternalPiece } from "./tuning";
import type { PowerRange } from "./types";

/**
 * Gear power of a set of pieces plus fixed `weapons`: floor(mean) over the pieces with a
 * known power and every weapon; null when there is nothing to average.
 */
export function loadoutPower(
  pieces: readonly { power?: number }[],
  weapons: readonly number[] = [],
): number | null {
  let sum = 0;
  let n = weapons.length;
  for (const w of weapons) sum += w;
  for (const p of pieces) {
    if (p.power === undefined) continue;
    sum += p.power;
    n++;
  }
  return n === 0 ? null : Math.floor(sum / n);
}

export interface PowerTracker {
  /** Account for `p` joining the running prefix. */
  push(p: InternalPiece): void;
  /** Undo `push(p)`. */
  pop(p: InternalPiece): void;
  /**
   * Can some completion of slots k..4 still land the loadout inside the range? At
   * k = NUM_SLOTS this is the exact leaf check.
   */
  feasible(k: number): boolean;
}

/**
 * Build the tracker for `range` over the deduped `slots`, or null when there is no range
 * (so the hot paths skip the calls entirely). `upLo[k]` / `upHi[k]` are the best lower-
 * side / upper-side slack a completion of slots k..4 can add; `allUnknown[k]` is whether
 * every slot in k..4 offers a piece with no known power (the only way a completion can
 * finish with zero known pieces, which passes the range unconditionally).
 */
export function createPowerTracker(
  slots: InternalPiece[][],
  range: PowerRange | undefined,
): PowerTracker | null {
  if (!range) return null;
  const { min, max } = range;
  const weapons = range.weapons ?? [];
  const lo = (p: InternalPiece): number => (p.power === undefined ? 0 : p.power - min);
  const hi = (p: InternalPiece): number => (p.power === undefined ? 0 : max + 1 - p.power);

  const upLo = new Array(NUM_SLOTS + 1).fill(0);
  const upHi = new Array(NUM_SLOTS + 1).fill(0);
  const allUnknown = new Array(NUM_SLOTS + 1).fill(true);
  for (let k = NUM_SLOTS - 1; k >= 0; k--) {
    let bestLo = -Infinity;
    let bestHi = -Infinity;
    let hasUnknown = false;
    for (const p of slots[k]) {
      if (p.power === undefined) hasUnknown = true;
      const l = lo(p);
      const h = hi(p);
      if (l > bestLo) bestLo = l;
      if (h > bestHi) bestHi = h;
    }
    upLo[k] = upLo[k + 1] + bestLo;
    upHi[k] = upHi[k + 1] + bestHi;
    allUnknown[k] = allUnknown[k + 1] && hasUnknown;
  }

  // The weapons are in every loadout: start the running sums with them.
  let slackLo = 0;
  let slackHi = 0;
  let known = weapons.length;
  for (const w of weapons) {
    slackLo += w - min;
    slackHi += max + 1 - w;
  }
  return {
    push(p) {
      if (p.power === undefined) return;
      slackLo += p.power - min;
      slackHi += max + 1 - p.power;
      known++;
    },
    pop(p) {
      if (p.power === undefined) return;
      slackLo -= p.power - min;
      slackHi -= max + 1 - p.power;
      known--;
    },
    feasible(k) {
      // Lower side: with no known piece both slacks are 0, so this is exact for the
      // all-unknown case too.
      if (slackLo + upLo[k] < 0) return false;
      // Upper side needs strictly positive slack ONLY once a known piece is in the
      // loadout; a completion that stays all-unknown is exempt.
      if (slackHi + upHi[k] < 1 && !(known === 0 && allUnknown[k])) return false;
      return true;
    },
  };
}
