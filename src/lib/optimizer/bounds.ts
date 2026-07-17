import type {
  OptimizerInput,
  OptimizerPiece,
  SetRequirement,
} from "./types";
import { NUM_SLOTS, NUM_STATS } from "./floors";
import {
  deficitPoints,
  makeInternalPiece,
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
  allowTuning: boolean,
  allowBalanced: boolean,
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
    const key =
      (p.exotic ? `E${p.hash ?? 0}` : "L") +
      (p.artifice ? "A" : "") +
      (keyIncludesSet ? `|${p.setHash ?? 0}|` : "|") +
      `T${tuneKey}|` +
      p.stats.join(",");
    if (!map.has(key)) {
      map.set(key, makeInternalPiece(p, allowTuning, allowBalanced));
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
} {
  const suffixStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
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
    let slotBestTotal = 0;
    slotSubsetMax.fill(0);
    for (const p of slots[k]) {
      for (let s = 0; s < NUM_STATS; s++) {
        const v = p.stats[s] + p.tuneStatUpside[s];
        if (v > slotMax[s]) slotMax[s] = v;
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
  return { suffixStat, suffixTotal, setSuffix, exoticSuffix, artSuffix, subsetSuffix };
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
        // Deficit before suffix help; suffixStat ≥ 0, so short ≤ 0 implies d ≤ 0.
        const short = mins[s] - (sum[s] + frag[s] + sumTuneUp[s]);
        if (short <= 0) continue;
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
      // Deficit before suffix help; suffixStat ≥ 0, so short ≤ 0 implies d ≤ 0.
      const short = mins[s] - (sum[s] + frag[s] + sumTuneUp[s]);
      if (short <= 0) continue;
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
    dedupe(s.filter(eligible), reqs.length > 0, allowTuning, allowBalanced).sort(
      (a, b) => b.total - a.total,
    ),
  );
}
