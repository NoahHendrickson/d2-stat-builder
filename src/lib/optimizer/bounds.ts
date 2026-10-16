import type {
  OptimizerInput,
  OptimizerPiece,
  SetRequirement,
} from "./types";
import { NUM_SLOTS, NUM_STATS, STAT_CAP, clamp } from "./floors";
// Relative import: this module runs in the worker AND in vitest, which has no "@/" alias.
import { ARTIFICE_MOD_BONUS } from "../armory/stats";
import {
  deficitPoints,
  directionalsBranchable,
  makeInternalPiece,
  minShortfall,
  type InternalPiece,
} from "./tuning";

/** Number of stat-subset masks for the subset-sum suffix bound (2^NUM_STATS). */
const NUM_MASKS = 1 << NUM_STATS;

/**
 * Collapse pieces with an identical stat vector (+ exotic, + set, + tuning) to one
 * representative.
 *
 * NOTE — dominance (Pareto) pruning was implemented here and measured (2026-07-03):
 * on Armor 3.0 pools it removes NOTHING, because every Tier-5 piece carries the same
 * fixed 90-point stat budget and domination requires a strictly greater total. It was
 * removed rather than left dormant: its soundness also depends on constraints being
 * stat MINIMUMS only, so a future stat-maximum / waste-limit feature would have made
 * it silently unsound. If gear stat totals ever vary again (e.g. legacy legendary
 * support), recover the filter and its tests from commit a3a6f61.
 */
function dedupe(
  pieces: OptimizerPiece[],
  keyOf: (p: OptimizerPiece) => string,
  keyIncludesPower: boolean,
  allowTuning: boolean,
  allowBalanced: boolean,
  mins: number[],
): InternalPiece[] {
  const map = new Map<string, InternalPiece>();
  for (const p of pieces) {
    const key = keyOf(p);
    const kept = map.get(key);
    if (
      kept === undefined ||
      (!keyIncludesPower && (p.power ?? -Infinity) > (kept.power ?? -Infinity))
    ) {
      // Replacing an existing key keeps its position in the Map, so pool order is stable.
      map.set(key, makeInternalPiece(p, allowTuning, allowBalanced, mins));
    }
  }
  return Array.from(map.values());
}

/**
 * The identity dedupe collapses on: two pieces with the same key are interchangeable
 * for the query, so the search keeps one and a result never names the other.
 */
function interchangeKey(
  p: OptimizerPiece,
  keyIncludesSet: boolean,
  keyIncludesPower: boolean,
  allowTuning: boolean,
  allowBalanced: boolean,
): string {
  // Two pieces with the same stats but different tuned stats aren't interchangeable
  // (except exotics, whose flexible slot makes the rolled tuned stat irrelevant).
  // A Balanced-only piece has no directionals at all, so it never stands in for one
  // that does — exotic or not; with Balanced disallowed it has no options left and is
  // an untunable piece ("-"). offStats only feed the Balanced option, so with
  // Balanced disallowed they drop out of the key (pieces differing only in offStats
  // become interchangeable).
  const tuneKey =
    allowTuning && p.tuning
      ? (p.tuning.directional === false
          ? allowBalanced
            ? "B"
            : "-"
          : p.exotic
            ? "X"
            : `${p.tuning.tuned}`) + (allowBalanced ? `:${p.tuning.offStats.join(".")}` : "")
      : "-";
  // A missing hash or set is "-", never a real value: set hash 0 counts toward a
  // requirement on set 0, "no set" doesn't. Power splits the key only while a power
  // range is enforced; without one, same-stat pieces at different power are
  // interchangeable to the search — but each build reports its gear power, so dedupe
  // represents the class by its highest-power piece (known power above unknown),
  // whatever order the armory listed them in.
  return (
    (p.exotic ? `E${p.hash ?? "-"}` : "L") +
    (p.artifice ? "A" : "") +
    (keyIncludesSet ? `|${p.setHash ?? "-"}|` : "|") +
    (keyIncludesPower ? `P${p.power ?? "?"}|` : "") +
    `T${tuneKey}|` +
    p.stats.join(",")
  );
}

/**
 * `interchangeKey` with the options a query implies. The one source of the dedupe rule:
 * buildSlots dedupes with it, and the armor usage history credits twins with it.
 */
export function makeInterchangeKey(input: OptimizerInput): (p: OptimizerPiece) => string {
  const keyIncludesSet = (input.setRequirements ?? []).length > 0;
  const keyIncludesPower = input.powerRange !== undefined;
  const allowTuning = input.allowTuning ?? true;
  const allowBalanced = input.allowBalancedTuning ?? true;
  return (p) => interchangeKey(p, keyIncludesSet, keyIncludesPower, allowTuning, allowBalanced);
}

/** Whether the query's exotic constraint lets a piece into the search pool at all. */
export function makeExoticEligible(input: OptimizerInput): (p: OptimizerPiece) => boolean {
  const exoticMode = input.exotic?.mode ?? "any";
  const exoticHashes = input.exotic?.hashes;
  return (p) =>
    !p.exotic ||
    (exoticMode === "none"
      ? false
      : exoticMode !== "specific" ||
        (p.hash !== undefined && !!exoticHashes?.includes(p.hash)));
}

/**
 * Suffix bounds over slots k..4: per-stat max and best-total (both including each
 * piece's best tuning upside, so feasibility/top-N bounds never prune a reachable
 * loadout), per-set reachability, and exotic reachability. Shared by the top-N search
 * and the ceiling probes so the two can't drift apart. Exported for tests (the
 * admissibility property harness builds the bound exactly as runCeilings does).
 *
 * `subsetSuffix[k][M]` is the subset-mask analogue of `suffixStat`: the max total a
 * completion of slots k..4 can contribute to the stat-subset `M` — per slot the max
 * over pieces of (the piece's summed stats over M + its best SINGLE tuning option's
 * contribution to M, floored at 0, + 3 if it is artifice). Where `suffixStat` lets each stat's max come from
 * a DIFFERENT piece in the same slot (the "phantom piece"), `subsetSuffix` charges one
 * real piece per slot for the whole subset, so two jointly-impossible-but-individually-
 * reachable minimums are disproven at the prefix instead of by exhaustive walking.
 * Singleton masks coincide with `suffixStat` exactly (`maskTuneUp` on a singleton is
 * `tuneStatUpside`); a regression test pins that subsumption.
 */
export interface SuffixBounds {
  suffixStat: number[][];
  /**
   * Best (total + tuning credit + own artifice +3) a completion of slots k..4 can add.
   * The credit is each piece's `tuneCredit` — construction-time `tuneTotalUpside`, or
   * the pool-tightened value when `topN` was given (see tightenedTuneCredit). An
   * artifice piece's free +3 is charged to THAT piece, not to the slot: a per-slot "+3 if
   * any piece here is artifice" credit (`artSuffix`) lets the best-total piece and the
   * artifice piece be two different pieces in one slot — a phantom +3 per slot that kept
   * every all-Tier-5 subtree alive against a heap full of ties.
   */
  suffixTotal: number[];
  setSuffix: number[][];
  exoticSuffix: number[];
  artSuffix: number[];
  subsetSuffix: number[][];
  suffixMinStat: number[][];
  suffixLowStat: number[][];
  suffixNetTotal: number[];
  /** Per-piece tuning credit used in suffixTotal, indexed [slot][piece index]. */
  tuneCredit: number[][];
}

export function computeSuffixBounds(
  slots: InternalPiece[][],
  reqs: SetRequirement[],
  needExotic: boolean,
  isChosenExotic: (p: InternalPiece) => boolean,
  /**
   * Top-N only: tighten each piece's tuning credit for THIS query's minimums and
   * fragments (tightenedTuneCredit). The ceiling probes must not pass it — they raise
   * minimums past the query's, and the credit is derived from the query's.
   */
  topN?: { frag: number[]; mins: number[]; maxModPoints: number },
): SuffixBounds {

  const suffixStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  // Lower-side companions of suffixStat: suffixMinStat[k][s] = Σ over slots k..4 of the
  // slot's LOWEST stat s before tuning (the fragment term's floor), and
  // suffixLowStat[k][s] = Σ of the slot's lowest (stat s + the piece's own worst −5 on
  // s) — what a completion contributes to s at the very least, tuning included. The
  // latter is per PIECE: pairing one piece's lowest roll with another piece's −5 (a
  // Tier-5 piece's −5 under a legacy piece's 4) is a phantom that no completion can
  // realize, and it made every lower-bound term pay for legacy pieces that were never
  // chosen (see zeroClampSlack).
  const suffixMinStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  const suffixLowStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  // slotLowStat[j][s]: slot j's own term of suffixLowStat (for tightenedTuneCredit).
  const slotLowStat: number[][] = Array.from({ length: NUM_SLOTS }, () =>
    new Array(NUM_STATS).fill(0),
  );
  const suffixTotal = new Array(NUM_SLOTS + 1).fill(0);
  // suffixTotal's twin for the second admission bound: best (total + NET tuning) per slot.
  const suffixNetTotal = new Array(NUM_SLOTS + 1).fill(0);
  // setSuffix[r][k] = number of slots in k..4 that contain ≥1 piece of reqs[r].setHash.
  const setSuffix = reqs.map(() => new Array(NUM_SLOTS + 1).fill(0));
  const exoticSuffix = new Array(NUM_SLOTS + 1).fill(0);
  // artSuffix[k] = number of slots in k..4 offering ≥1 artifice piece — an upper bound
  // on the free +3 mods any completion from slot k can still add. Every stat and total
  // bound here charges artifice per PIECE instead (see SuffixBounds), so this only
  // bounds the remaining slots' artifice in the zero-clamp slack.
  const artSuffix = new Array(NUM_SLOTS + 1).fill(0);
  const subsetSuffix: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_MASKS).fill(0),
  );
  // Subset-sum DP scratch (index 0 stays 0 — the empty mask contributes nothing).
  const statSum = new Array(NUM_MASKS).fill(0);
  const optSum = new Array(NUM_MASKS).fill(0);
  const bestTuneUp = new Array(NUM_MASKS).fill(0);
  const slotSubsetMax = new Array(NUM_MASKS).fill(0);
  for (let k = NUM_SLOTS - 1; k >= 0; k--) {
    const slotMax = new Array(NUM_STATS).fill(0);
    const slotMin = new Array(NUM_STATS).fill(Infinity);
    const slotLow = new Array(NUM_STATS).fill(Infinity);
    let slotBestNet = 0;
    slotSubsetMax.fill(0);
    for (let i = 0; i < slots[k].length; i++) {
      const p = slots[k][i];
      // An artifice piece's free +3 can land on any ONE stat, so it adds at most 3 to
      // each stat's max and at most 3 to any subset's sum — charged to the piece itself
      // (the same no-phantom rule as suffixTotal; see SuffixBounds).
      const art = p.artifice ? ARTIFICE_MOD_BONUS : 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const v = p.stats[s] + p.tuneStatUpside[s] + art;
        if (v > slotMax[s]) slotMax[s] = v;
        if (p.stats[s] < slotMin[s]) slotMin[s] = p.stats[s];
        const low = p.stats[s] + p.tuneStatDownside[s];
        if (low < slotLow[s]) slotLow[s] = low;
      }
      const n = p.total + p.tuneNetUpside + (p.artifice ? ARTIFICE_MOD_BONUS : 0);
      if (n > slotBestNet) slotBestNet = n;
      // This piece's summed stats over every stat-subset mask (statSum[m] extends the
      // mask-minus-lowest-bit sum by the lowest bit's stat).
      for (let m = 1; m < NUM_MASKS; m++) {
        const low = m & -m;
        statSum[m] = statSum[m ^ low] + p.stats[31 - Math.clz32(low)];
      }
      // maskTuneUp: the best SINGLE tuning option's contribution to each mask, floored
      // at 0 — one option per piece, so the +5/−5 directional trade-offs can't be
      // double-counted the way summed per-stat upsides would. Reproduces
      // tuneStatUpside exactly on singleton masks.
      bestTuneUp.fill(0);
      for (const opt of p.tuneOpts) {
        for (let m = 1; m < NUM_MASKS; m++) {
          const low = m & -m;
          const v = optSum[m ^ low] + opt.vec[31 - Math.clz32(low)];
          optSum[m] = v;
          if (v > bestTuneUp[m]) bestTuneUp[m] = v;
        }
      }
      for (let m = 1; m < NUM_MASKS; m++) {
        const v = statSum[m] + bestTuneUp[m] + art;
        if (v > slotSubsetMax[m]) slotSubsetMax[m] = v;
      }
    }
    for (let s = 0; s < NUM_STATS; s++) {
      suffixStat[k][s] = suffixStat[k + 1][s] + slotMax[s];
      suffixMinStat[k][s] = suffixMinStat[k + 1][s] + slotMin[s];
      suffixLowStat[k][s] = suffixLowStat[k + 1][s] + slotLow[s];
      slotLowStat[k][s] = slotLow[s];
    }
    for (let m = 1; m < NUM_MASKS; m++) {
      subsetSuffix[k][m] = subsetSuffix[k + 1][m] + slotSubsetMax[m];
    }
    suffixNetTotal[k] = suffixNetTotal[k + 1] + slotBestNet;
    for (let r = 0; r < reqs.length; r++) {
      const has = slots[k].some((p) => p.setHash === reqs[r].setHash) ? 1 : 0;
      setSuffix[r][k] = setSuffix[r][k + 1] + has;
    }
    if (needExotic) {
      const has = slots[k].some(isChosenExotic) ? 1 : 0;
      exoticSuffix[k] = exoticSuffix[k + 1] + has;
    }
    artSuffix[k] = artSuffix[k + 1] + (slots[k].some((p) => p.artifice) ? 1 : 0);
  }
  // The tuning credit needs the pool-wide per-stat ranges above (slot 0 = whole pool),
  // so suffixTotal is a second, cheap pass.
  const tuneCredit = topN
    ? tightenedTuneCredit(
        slots,
        topN.frag,
        topN.mins,
        topN.maxModPoints,
        suffixStat[0],
        suffixLowStat[0],
        slotLowStat,
      )
    : slots.map((slot) => slot.map((p) => p.tuneTotalUpside));
  for (let k = NUM_SLOTS - 1; k >= 0; k--) {
    let slotBestTotal = 0;
    for (let i = 0; i < slots[k].length; i++) {
      const p = slots[k][i];
      const t = p.total + tuneCredit[k][i] + (p.artifice ? ARTIFICE_MOD_BONUS : 0);
      if (t > slotBestTotal) slotBestTotal = t;
    }
    suffixTotal[k] = suffixTotal[k + 1] + slotBestTotal;
  }
  return {
    suffixStat,
    suffixTotal,
    setSuffix,
    exoticSuffix,
    artSuffix,
    subsetSuffix,
    suffixMinStat,
    suffixLowStat,
    suffixNetTotal,
    tuneCredit,
  };
}

/**
 * The clamp-at-zero term of the second admission bound. That bound sums each stat's
 * pre-mod value SIGNED (pieces' stats + fragments + net tuning, where a directional's
 * +5/−5 cancel) and pays for the 0-clamp separately: `Σ_s clamp(v_s) ≤ Σ_s v_s +
 * Σ_s max(0, −v_s)`, and `−v_s` is bounded from slot k by the lowest `v_s` any leaf the
 * tuner can accept has — the chosen pieces' rolls and worst −5s plus the remaining
 * slots' lowest rolls and the −5s that could still land there, or, for a stat with a
 * minimum, that minimum minus everything mods and artifice could have supplied (a
 * feasible leaf ends at or above its minimum).
 *
 * Evaluated per NODE from the walk's live `sum` / `sumTuneDown`, not once per query from
 * the slot-0 pool minima: a pool-wide "lowest" is set by the single lowest roll in each
 * slot, so a handful of legacy (Armor 2.0) pieces with a 4 in some stat make every
 * subtree — including the all-Tier-5 ones that never go near zero — pay the same slack.
 * Once a Tier-5 piece is chosen its real roll replaces its slot's minimum and the slack
 * collapses, which is what prunes the legacy-piece subtrees at depth 1.
 *
 * Pure in its arguments: `sum` / `sumTuneDown` are the prefix, `lowStat` the remaining
 * slots' row of suffixLowStat, `maxArtifice` the artifice pieces the leaf can hold.
 */
function zeroClampSlack(
  frag: number[],
  mins: number[],
  sum: number[],
  sumTuneDown: number[],
  lowStat: number[],
  maxModPoints: number,
  maxArtifice: number,
): number {
  let slack = 0;
  for (let s = 0; s < NUM_STATS; s++) {
    let lowest = sum[s] + frag[s] + sumTuneDown[s] + lowStat[s];
    if (mins[s] > 0) {
      const fromMin = mins[s] - maxModPoints - maxArtifice * ARTIFICE_MOD_BONUS;
      if (fromMin > lowest) lowest = fromMin;
    }
    if (lowest < 0) slack -= lowest;
  }
  return slack;
}

/** Clamped-total cost of one −5 on a stat whose value, before that −5, is `v`. */
const minusFiveLoss = (v: number): number => clamp(v) - clamp(v - 5);

/**
 * The top-N bound's per-piece tuning credit, tightened with pool-wide knowledge — a table
 * indexed [slot][piece], never more than the piece's `tuneTotalUpside` (which stays as
 * built: `InternalPiece` has one writer, makeInternalPiece, and the ceiling probes go on
 * seeing construction-time upsides). makeInternalPiece credits a directional at its full +5 on
 * the grounds that the −5 might be absorbed by the 0-clamp (or the 200 cap). Whether it
 * CAN be is a pool property: with `v` the minus stat's value before that −5, the −5
 * costs `clamp(v) − clamp(v − 5)` of clamped total, and over every completion `v` lies in
 *   [frag + the piece's own roll + Σ other slots' lowest (roll + own −5),
 *    frag + Σ best (roll + tuning upside + artifice) + every mod point]
 * (`suffixLowStat` minus the piece's slot, plus its own stat, and `suffixStat` at slot
 * 0 — the piece's own −5 is the one being priced). Mods only add, so they widen the
 * upper end alone: a stat near the cap that mods push past 205 absorbs the −5 there. The loss is a trapezoid in `v` — 0 below 0,
 * rising to 5, flat through the cap, falling back to 0 past 205 — so its minimum over an
 * interval is at an endpoint. On Tier-5 pools every stat sits well inside [5, 200] under
 * every completion, so the −5 always costs the full 5 and a directional's net upside is
 * 0 — Balanced's 3 becomes the credit, which is what lets the walk prune ties.
 *
 * Soundness of the credit: peeling the chosen tunings off a loadout one piece at a
 * time, Σ_s clamp(final_s) grows by at most (+5 − loss) per directional (the +5 side is
 * Lipschitz-1) and by its positive parts per Balanced, whatever else is stacked on the
 * stat — so the sum of these per-piece credits bounds the tuning's whole contribution to
 * the clamped total, matching how solve() adds `tuneTotalUpside` into `runningTotal`
 * and `suffixTotal`. Directionals the searcher never branches (`directionalsBranchable`
 * false for `mins`) are excluded, as in makeInternalPiece. The per-stat upsides feeding
 * the joint-min check and the ceiling probes keep the full +5 (probes raise minimums
 * past the query's), which is why this is a query-specific table and not a piece field.
 */
function tightenedTuneCredit(
  slots: InternalPiece[][],
  frag: number[],
  mins: number[],
  maxModPoints: number,
  /** Pool-wide per-stat ranges: computeSuffixBounds' slot-0 rows, and per-slot lows. */
  poolMaxStat: number[],
  poolLowStat: number[],
  slotLowStat: number[][],
): number[][] {
  const capLoss = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    capLoss[s] = minusFiveLoss(frag[s] + poolMaxStat[s] + maxModPoints);
  }
  const short = (s: number): boolean => mins[s] > 0;
  return slots.map((slot, j) =>
    slot.map((p) => {
      const dirReachable = directionalsBranchable(p.exotic, p.tuned, short);
      let best = 0;
      for (const opt of p.tuneOpts) {
        let gain = 0;
        if (opt.applied?.kind === "directional") {
          if (!dirReachable) continue;
          const m = opt.applied.minus;
          // This piece's own roll on the minus stat plus the other slots' lows.
          const lowest = frag[m] + p.stats[m] + poolLowStat[m] - slotLowStat[j][m];
          gain = 5 - Math.min(minusFiveLoss(lowest), capLoss[m]);
        } else {
          for (let s = 0; s < NUM_STATS; s++) if (opt.vec[s] > 0) gain += opt.vec[s];
        }
        if (gain > best) best = gain;
      }
      return best < p.tuneTotalUpside ? best : p.tuneTotalUpside;
    }),
  );
}

/**
 * The fragment term of the top-N admission bound. The bound sums each stat's pre-clamp
 * value as `Σ pieces' stats + fragment`, and `Σ_s clamp(v_s) ≤ Σ_s max(0, v_s)`. Crediting
 * every fragment's positive part (ignoring the negatives) is always admissible, but when
 * the chosen pieces plus the remaining slots' lowest rolls already cover a negative
 * fragment the stat can't fall below 0, so `max(0, v_s) = v_s` and the negative fragment
 * counts in full — a mixed fragment set that nets to zero then adds nothing to the bound
 * instead of its positive half. Per node, for the same reason as zeroClampSlack, and pure
 * in the same way (`minStat` is the remaining slots' row of suffixMinStat).
 */
function fragmentCredit(frag: number[], sum: number[], minStat: number[]): number {
  let credit = 0;
  for (let s = 0; s < NUM_STATS; s++) {
    // A positive fragment always counts; a negative one counts (reducing the bound)
    // only when the prefix + the lowest remaining rolls keep the stat at or above 0.
    if (frag[s] > 0 || frag[s] + sum[s] + minStat[s] >= 0) credit += frag[s];
  }
  return credit;
}

/**
 * Overshoot ceiling of a mod covering: `assignMods` closes a deficit with majors first
 * (at most ⌈d/10⌉ of them, so ≤ 9 over) and finishes with minors (≤ 4 over), so the
 * stat-mod points it puts on a stat never exceed that stat's deficit by more than this.
 * Pinned by a property test in tuning.test.ts; the mod-slack bound below relies on it.
 */
export const MAX_MOD_OVERSHOOT = 9;

/**
 * The mod term of the top-N admission bound: how much the stat mods can still add to a
 * loadout's clamped total from slot k. The flat credit (`maxModPoints`) is admissible but
 * blind to WHEN mods are used: `assignMods` socket mods only to cover a deficit on a stat
 * with a positive minimum, so with no minimums the true mod upside is zero — and a flat
 * +25 there is exactly what stops the walk from pruning total ties against a full heap.
 *
 * Per stat with a positive minimum: mods land only if the pre-mod value `aug` is under
 * the minimum, and then `clamp(aug + points) ≤ min(STAT_CAP, min + MAX_MOD_OVERSHOOT)`.
 * The gain in the clamped total is therefore at most that cap minus `clamp(aug)`, and
 * `aug` is at least the chosen pieces' stats + fragments + every −5 the chosen and
 * remaining pieces could still land + the remaining slots' lowest rolls. Summed over the
 * minimum-bearing stats and capped by the budget, this is a valid upper bound on
 * Σ_s [clamp(aug_s + points_s) − clamp(aug_s)] — the part of the total that mods
 * contribute once tuning has been credited separately (Lipschitz-1 clamp). `mins` is
 * SNAPSHOTTED here (the targeted stats and their caps are fixed at creation) — unlike
 * makeJointMinCheck, this bound is never handed to the ceiling probes, and solve()
 * never changes the minimums during its walk. `sum`/`sumTuneDown` are the walk's
 * running accumulators, read live.
 */
export function makeModUpside(
  mins: number[],
  sum: number[],
  frag: number[],
  sumTuneDown: number[],
  suffixLowStat: number[][],
  maxModPoints: number,
): (k: number) => number {
  const targeted: number[] = [];
  const cap: number[] = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    if (mins[s] > 0) {
      targeted.push(s);
      cap[s] = Math.min(STAT_CAP, mins[s] + MAX_MOD_OVERSHOOT);
    }
  }
  if (targeted.length === 0 || maxModPoints === 0) return () => 0;
  return (k) => {
    let upside = 0;
    for (let i = 0; i < targeted.length; i++) {
      const s = targeted[i];
      const lowest = sum[s] + frag[s] + sumTuneDown[s] + suffixLowStat[k][s];
      const gain = cap[s] - clamp(lowest);
      if (gain > 0) upside += gain;
    }
    return upside < maxModPoints ? upside : maxModPoints;
  };
}

/**
 * Shared joint-feasibility bound for the top-N search and the ceiling probes — the two
 * MUST be the same check (bound drift between the walks is how the over-reported-ceiling
 * class of bug happens). From slot k, every stat's optimistic completion (chosen pieces
 * + best remaining pieces + tuning upside + the remaining pieces' own artifice +3s) must
 * reach its minimum, and JOINTLY the mod points needed across all stats must fit the
 * shared budget, widened by +3 per CHOSEN artifice piece (the remaining slots' artifice
 * is already inside suffixStat / subsetSuffix, charged to the piece that carries it).
 * The joint check is what prunes multi-constraint queries early enough to avoid
 * exhaustive walks. `mins` is read live (probes mutate it); `chosenArt.n` is the
 * caller's running artifice count. Exported for tests.
 *
 * Two complementary checks, prune if EITHER fails:
 *  - per-stat (unchanged): each stat's own deficit past `suffixStat`, mod-grain rounded
 *    per stat — tighter on rounding (Σ ceil5(dᵢ) ≥ ceil5(Σ dᵢ));
 *  - subset-mask: the stats still short BEFORE suffix help (`short > 0` — NOT `d > 0`:
 *    in the profiled failure every stat is individually reachable, d ≤ 0, while the
 *    joint completion is impossible) share one real piece per remaining slot, so their
 *    combined shortfall is charged against `subsetSuffix[k][mask]` — tighter in the
 *    suffix dimension, admissibly looser in rounding (one ceil5 over the whole mask).
 */
export function makeJointMinCheck(
  mins: number[],
  sum: number[],
  sumTuneUp: number[],
  frag: number[],
  suffixStat: number[][],
  subsetSuffix: number[][],
  maxModPoints: number,
  chosenArt: { n: number },
): (k: number) => boolean {
  return (k) => {
    // Only the chosen artifice +3s are still free to land anywhere; the remaining
    // slots' are folded into the suffix bounds above. With none chosen (always, on a
    // pool without artifice), every point left to find comes from 5-grain stat mods,
    // so the deficit rounds up.
    const artUp = chosenArt.n;
    const budget = maxModPoints + artUp * ARTIFICE_MOD_BONUS;
    let needed = 0;
    let mask = 0;
    let maskShort = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      // Shortfall before suffix help (minShortfall owns the zero-minimum/clamp
      // rule); suffixStat ≥ 0, so short = 0 implies d ≤ 0.
      const short = minShortfall(mins[s], sum[s] + frag[s] + sumTuneUp[s]);
      if (short === 0) continue;
      mask |= 1 << s;
      maskShort += short;
      const d = short - suffixStat[k][s];
      if (d > 0) {
        needed += deficitPoints(d, artUp > 0);
        if (needed > budget) return false;
      }
    }
    if ((mask & (mask - 1)) !== 0) {
      // ≥2 short stats (a singleton mask duplicates the per-stat check exactly).
      const D = maskShort - subsetSuffix[k][mask];
      if (D > 0 && deficitPoints(D, artUp > 0) > budget) return false;
    }
    return true;
  };
}

/**
 * Build the per-slot search pool shared by solve() and solveCeilings(): pre-filter
 * pieces the exotic constraint excludes (they can never appear in a valid loadout,
 * but left in the pool they inflate every suffix bound — looser bounds → less
 * pruning — and slot sizes), then dedupe, sorted by total.
 */
export function buildSlots(input: OptimizerInput): InternalPiece[][] {
  const allowTuning = input.allowTuning ?? true;
  const allowBalanced = input.allowBalancedTuning ?? true;
  const eligible = makeExoticEligible(input);
  const keyOf = makeInterchangeKey(input);
  return input.slots.map((s) =>
    dedupe(
      s.filter(eligible),
      keyOf,
      input.powerRange !== undefined,
      allowTuning,
      allowBalanced,
      input.minimums,
    ).sort(
      (a, b) => b.total - a.total,
    ),
  );
}

/**
 * The top-N admission bound: an upper bound on the maximize-mode total of any leaf the
 * tuner can accept that completes the current prefix from slot k. Built ONCE, here, for
 * solve() and the admissibility property test alike — the bound is the min of two
 * admissible totals plus shared terms, and assembling that from primitives in two places
 * is how bounds drift (makeJointMinCheck exists for the same reason).
 *
 * Both bounds = chosen pieces' stats + a tuning credit + the chosen artifice +3s + the
 * best the remaining slots can add (each remaining piece charged its own total, tuning
 * credit and artifice +3 — see SuffixBounds.suffixTotal) + what mods can still
 * contribute (makeModUpside) + a fragment term:
 *  1. `positive`: tuning credited by its positive parts per piece (a −5 might be absorbed
 *     by a clamp; `suffix.tuneCredit` tightens this pool-wide), fragments by their
 *     unabsorbable part (fragmentCredit);
 *  2. `net`: tuning credited NET per piece (+5/−5 cancel), fragments signed, and every
 *     clamp-at-zero absorption paid once from the prefix (zeroClampSlack) — tighter
 *     when negative fragments or many directionals make bound 1 credit −5s as free.
 * The walk reports each chosen piece through push/pop; `sum`, `sumTuneDown` and
 * `chosenArt` are the walk's own accumulators (shared with the joint-min check).
 */
export interface AdmissionBound {
  /** Account for the piece at slots[k][i] being chosen / undo it. */
  push(k: number, i: number): void;
  pop(k: number, i: number): void;
  /**
   * True when no leaf completing the prefix from slot k can beat `worst` (admission is
   * strict, so a tie can't enter either). Evaluates the cheap part of both bounds first
   * and only loops over the mod term when it could still matter.
   */
  cannotBeat(k: number, worst: number): boolean;
  /**
   * The two bounds on their own, per-node terms only, through the same expression
   * cannotBeat prunes with — each must be admissible by itself (tests).
   */
  positive(k: number): number;
  net(k: number): number;
}

export function makeAdmissionBound(
  slots: InternalPiece[][],
  suffix: SuffixBounds,
  mins: number[],
  sum: number[],
  frag: number[],
  sumTuneDown: number[],
  maxModPoints: number,
  chosenArt: { n: number },
): AdmissionBound {
  const { suffixTotal, suffixNetTotal, suffixMinStat, suffixLowStat, artSuffix, tuneCredit } =
    suffix;
  let fragSum = 0;
  for (let s = 0; s < NUM_STATS; s++) fragSum += frag[s];
  const modUpside = makeModUpside(
    mins,
    sum,
    frag,
    sumTuneDown,
    suffixLowStat,
    maxModPoints,
  );
  // The per-node fragment and slack terms, from the walk's live prefix.
  const fragAt = (k: number): number => fragmentCredit(frag, sum, suffixMinStat[k]);
  const slackAt = (k: number): number =>
    zeroClampSlack(
      frag,
      mins,
      sum,
      sumTuneDown,
      suffixLowStat[k],
      maxModPoints,
      chosenArt.n + artSuffix[k],
    );
  // The same terms on the EMPTY prefix are pool-wide constants (a chosen piece
  // contributes at least its slot's floor, so the per-node values only ever come in at
  // or under these). Computed from explicit zero sums, never the live accumulators, so
  // they stay the empty-prefix values whenever this factory is built. cannotBeat tries
  // the constants first and refines a side only when that fails to prune AND that side
  // can still drop — on a Tier-5 pool with non-negative fragments the slack is already 0
  // and every fragment already counts, so the hot walk never pays for the 6-stat loops.
  const empty = new Array(NUM_STATS).fill(0);
  const fragConst = fragmentCredit(frag, empty, suffixMinStat[0]);
  const slackConst = zeroClampSlack(
    frag,
    mins,
    empty,
    empty,
    suffixLowStat[0],
    maxModPoints,
    artSuffix[0],
  );
  const refineFrag = fragConst > fragSum;
  const refineSlack = slackConst > 0;
  let runningTotal = 0;
  let runningNet = 0;
  // The one bound expression, minus the mod term: min(positive, net) + the chosen
  // pieces' artifice +3s (the remaining slots' are inside suffixTotal / suffixNetTotal).
  // An Infinity term drops its side, which is how positive() / net() read one alone.
  const bound = (k: number, fragTerm: number, slack: number): number => {
    const a = runningTotal + suffixTotal[k] + fragTerm;
    const b = runningNet + suffixNetTotal[k] + fragSum + slack;
    return (a < b ? a : b) + chosenArt.n * ARTIFICE_MOD_BONUS;
  };
  return {
    push(k, i) {
      const p = slots[k][i];
      runningTotal += p.total + tuneCredit[k][i];
      runningNet += p.total + p.tuneNetUpside;
    },
    pop(k, i) {
      const p = slots[k][i];
      runningTotal -= p.total + tuneCredit[k][i];
      runningNet -= p.total + p.tuneNetUpside;
    },
    cannotBeat(k, worst) {
      // Each bound is admissible alone, so either one at or under `worst` prunes. The
      // mod term loops over the targeted stats and is last.
      let base = bound(k, fragConst, slackConst);
      if (base > worst && (refineFrag || refineSlack)) {
        base = bound(k, refineFrag ? fragAt(k) : fragConst, refineSlack ? slackAt(k) : slackConst);
      }
      // modUpside(k) ≥ 0: if the rest already beats worst, the answer is known.
      if (base > worst) return false;
      return base + modUpside(k) <= worst;
    },
    positive: (k) => bound(k, fragAt(k), Infinity) + modUpside(k),
    net: (k) => bound(k, Infinity, slackAt(k)) + modUpside(k),
  };
}

/**
 * The exotic rule for descending into a child, shared by the top-N walk and the ceiling
 * probes: the exotic count after choosing `p` at slot k, or −1 when the child can't lead
 * to a valid leaf — a second exotic, or (under "require"/"specific") no exotic yet and no
 * later slot able to supply one, so every leaf below would be rejected. Exotic-ineligible
 * pieces were already filtered out of the pool by buildSlots; this is the rest of that
 * rule, encoded once.
 */
export function nextExoticCount(
  exoticCount: number,
  p: InternalPiece,
  k: number,
  needExotic: boolean,
  exoticSuffix: number[],
): number {
  const next = exoticCount + (p.exotic ? 1 : 0);
  if (next > 1) return -1;
  if (needExotic && next === 0 && exoticSuffix[k + 1] === 0) return -1;
  return next;
}
