import type {
  OptimizerInput,
  OptimizerPiece,
  SetRequirement,
} from "./types";
import { NUM_SLOTS, NUM_STATS, STAT_CAP, clamp } from "./floors";
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
  keyIncludesSet: boolean,
  keyIncludesPower: boolean,
  allowTuning: boolean,
  allowBalanced: boolean,
  mins: number[],
): InternalPiece[] {
  const map = new Map<string, InternalPiece>();
  for (const p of pieces) {
    // Two pieces with the same stats but different tuned stats aren't interchangeable
    // (except exotics, whose flexible slot makes the rolled tuned stat irrelevant).
    // offStats only feed the Balanced option, so with Balanced disallowed they drop
    // out of the key (pieces differing only in offStats become interchangeable).
    const tuneKey =
      allowTuning && p.tuning
        ? (p.exotic ? "X" : `${p.tuning.tuned}`) +
          (allowBalanced ? `:${p.tuning.offStats.join(".")}` : "")
        : "-";
    // Power only tells pieces apart while a power range is being enforced — without one
    // the solver never reads it, so two same-stat pieces at different power stay one.
    const key =
      (p.exotic ? `E${p.hash ?? 0}` : "L") +
      (p.artifice ? "A" : "") +
      (keyIncludesSet ? `|${p.setHash ?? 0}|` : "|") +
      (keyIncludesPower ? `P${p.power ?? "?"}|` : "") +
      `T${tuneKey}|` +
      p.stats.join(",");
    if (!map.has(key)) {
      map.set(key, makeInternalPiece(p, allowTuning, allowBalanced, mins));
    }
  }
  return Array.from(map.values());
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
 * contribution to M, floored at 0). Where `suffixStat` lets each stat's max come from
 * a DIFFERENT piece in the same slot (the "phantom piece"), `subsetSuffix` charges one
 * real piece per slot for the whole subset, so two jointly-impossible-but-individually-
 * reachable minimums are disproven at the prefix instead of by exhaustive walking.
 * Singleton masks coincide with `suffixStat` exactly (`maskTuneUp` on a singleton is
 * `tuneStatUpside`); a regression test pins that subsumption.
 */
export function computeSuffixBounds(
  slots: InternalPiece[][],
  reqs: SetRequirement[],
  needExotic: boolean,
  isChosenExotic: (p: InternalPiece) => boolean,
): {
  suffixStat: number[][];
  suffixTotal: number[];
  setSuffix: number[][];
  exoticSuffix: number[];
  artSuffix: number[];
  subsetSuffix: number[][];
  suffixMinStat: number[][];
  suffixDownStat: number[][];
} {
  const suffixStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  // Lower-side companions of suffixStat, for the mod-slack bound (makeModUpside):
  // suffixMinStat[k][s] = Σ over slots k..4 of the slot's LOWEST stat s (any completion
  // contributes at least this), suffixDownStat[k][s] = Σ of the slot's worst tuning
  // downside on s (the −5s a completion could still land there).
  const suffixMinStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  const suffixDownStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  const suffixTotal = new Array(NUM_SLOTS + 1).fill(0);
  // setSuffix[r][k] = number of slots in k..4 that contain ≥1 piece of reqs[r].setHash.
  const setSuffix = reqs.map(() => new Array(NUM_SLOTS + 1).fill(0));
  const exoticSuffix = new Array(NUM_SLOTS + 1).fill(0);
  // artSuffix[k] = number of slots in k..4 offering ≥1 artifice piece — an upper bound
  // on the free +3 mods any completion from slot k can still add.
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
    const slotDown = new Array(NUM_STATS).fill(0);
    let slotBestTotal = 0;
    slotSubsetMax.fill(0);
    for (const p of slots[k]) {
      for (let s = 0; s < NUM_STATS; s++) {
        const v = p.stats[s] + p.tuneStatUpside[s];
        if (v > slotMax[s]) slotMax[s] = v;
        if (p.stats[s] < slotMin[s]) slotMin[s] = p.stats[s];
        if (p.tuneStatDownside[s] < slotDown[s]) slotDown[s] = p.tuneStatDownside[s];
      }
      const t = p.total + p.tuneTotalUpside;
      if (t > slotBestTotal) slotBestTotal = t;
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
        const v = statSum[m] + bestTuneUp[m];
        if (v > slotSubsetMax[m]) slotSubsetMax[m] = v;
      }
    }
    for (let s = 0; s < NUM_STATS; s++) {
      suffixStat[k][s] = suffixStat[k + 1][s] + slotMax[s];
      suffixMinStat[k][s] = suffixMinStat[k + 1][s] + slotMin[s];
      suffixDownStat[k][s] = suffixDownStat[k + 1][s] + slotDown[s];
    }
    for (let m = 1; m < NUM_MASKS; m++) {
      subsetSuffix[k][m] = subsetSuffix[k + 1][m] + slotSubsetMax[m];
    }
    suffixTotal[k] = suffixTotal[k + 1] + slotBestTotal;
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
  return {
    suffixStat,
    suffixTotal,
    setSuffix,
    exoticSuffix,
    artSuffix,
    subsetSuffix,
    suffixMinStat,
    suffixDownStat,
  };
}

/** Clamped-total cost of one −5 on a stat whose value, before that −5, is `v`. */
const minusFiveLoss = (v: number): number => clamp(v) - clamp(v - 5);

/**
 * Tighten each piece's `tuneTotalUpside` (the top-N bound's per-piece tuning credit)
 * using pool-wide knowledge. makeInternalPiece credits a directional at its full +5 on
 * the grounds that the −5 might be absorbed by the 0-clamp (or the 200 cap). Whether it
 * CAN be is a pool property: with `v` the minus stat's value before that −5, the −5
 * costs `clamp(v) − clamp(v − 5)` of clamped total, and over every completion `v` lies in
 *   [frag + Σ lowest rolls + Σ other worst −5s,  frag + Σ best (roll + tuning upside)]
 * (`suffixMinStat`/`suffixDownStat`/`suffixStat` at slot 0; the "+5" below excludes the
 * piece's own −5 from the downside sum). The loss is a trapezoid in `v` — 0 below 0,
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
 * false for `mins`) are excluded, as in makeInternalPiece. Only `tuneTotalUpside` is
 * touched: the per-stat upsides feeding the joint-min check and the ceiling probes
 * must keep the full +5 (probes raise minimums past the query's).
 */
export function tightenTuneTotalUpside(
  slots: InternalPiece[][],
  frag: number[],
  mins: number[],
): void {
  const lowest = new Array(NUM_STATS).fill(0);
  const highest = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    lowest[s] = frag[s] + 5;
    highest[s] = frag[s];
  }
  for (const slot of slots) {
    for (let s = 0; s < NUM_STATS; s++) {
      let mn = Infinity;
      let down = 0;
      let mx = 0;
      for (const p of slot) {
        if (p.stats[s] < mn) mn = p.stats[s];
        if (p.tuneStatDownside[s] < down) down = p.tuneStatDownside[s];
        const up = p.stats[s] + p.tuneStatUpside[s];
        if (up > mx) mx = up;
      }
      lowest[s] += mn + down;
      highest[s] += mx;
    }
  }
  const minLoss = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    minLoss[s] = Math.min(minusFiveLoss(lowest[s]), minusFiveLoss(highest[s]));
  }
  const short = (s: number): boolean => mins[s] > 0;
  for (const slot of slots) {
    for (const p of slot) {
      const dirReachable = directionalsBranchable(p.exotic, p.tuned, short);
      let best = 0;
      for (const opt of p.tuneOpts) {
        let gain = 0;
        if (opt.applied?.kind === "directional") {
          if (!dirReachable) continue;
          gain = 5 - minLoss[opt.applied.minus];
        } else {
          for (let s = 0; s < NUM_STATS; s++) if (opt.vec[s] > 0) gain += opt.vec[s];
        }
        if (gain > best) best = gain;
      }
      if (best < p.tuneTotalUpside) p.tuneTotalUpside = best;
    }
  }
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
 * read live; `sum`/`sumTuneDown` are the walk's running accumulators.
 */
export function makeModUpside(
  mins: number[],
  sum: number[],
  frag: number[],
  sumTuneDown: number[],
  suffixMinStat: number[][],
  suffixDownStat: number[][],
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
      const lowest =
        sum[s] + frag[s] + sumTuneDown[s] + suffixMinStat[k][s] + suffixDownStat[k][s];
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
 * + best remaining pieces + tuning upside) must reach its minimum, and JOINTLY the mod
 * points needed across all stats must fit the shared budget, widened by +3 per reachable
 * artifice piece. The joint check is what prunes multi-constraint queries early enough
 * to avoid exhaustive walks. `mins` is read live (probes mutate it); `chosenArt.n` is
 * the caller's running artifice count. Exported for tests.
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
  artSuffix: number[],
  maxModPoints: number,
  chosenArt: { n: number },
): (k: number) => boolean {
  // Pool has no artifice pieces at all (artSuffix[0] counts every slot): specialize to
  // the flat-budget bound so the per-node cost of these hot walks is exactly what it
  // was before artifice existed.
  if (artSuffix[0] === 0) {
    return (k) => {
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
          needed += deficitPoints(d, false);
          if (needed > maxModPoints) return false;
        }
      }
      if ((mask & (mask - 1)) !== 0) {
        // ≥2 short stats (a singleton mask duplicates the per-stat check exactly).
        const D = maskShort - subsetSuffix[k][mask];
        if (D > 0 && deficitPoints(D, false) > maxModPoints) return false;
      }
      return true;
    };
  }
  return (k) => {
    const artUp = chosenArt.n + artSuffix[k];
    const budget = maxModPoints + artUp * 3;
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
  const reqs = input.setRequirements ?? [];
  const allowTuning = input.allowTuning ?? true;
  const allowBalanced = input.allowBalancedTuning ?? true;
  const exoticMode = input.exotic?.mode ?? "any";
  const exoticHashes = input.exotic?.hashes;
  const eligible = (p: OptimizerPiece): boolean =>
    !p.exotic ||
    (exoticMode === "none"
      ? false
      : exoticMode !== "specific" ||
        (p.hash !== undefined && !!exoticHashes?.includes(p.hash)));
  return input.slots.map((s) =>
    dedupe(
      s.filter(eligible),
      reqs.length > 0,
      input.powerRange !== undefined,
      allowTuning,
      allowBalanced,
      input.minimums,
    ).sort((a, b) => b.total - a.total),
  );
}
