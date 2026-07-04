import type {
  ModBudget,
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  OptimizerPiece,
  SetRequirement,
} from "./types";
import {
  NUM_SLOTS,
  NUM_STATS,
  STAT_CAP,
  clamp,
  createTuningSearcher,
  deficitPoints,
  makeInternalPiece,
  type InternalPiece,
  type TuningOutcome,
} from "./tuning";

const DEFAULT_MAX_RESULTS = 200;
/**
 * Wall-clock budget for refining the per-stat ceilings past their seed values. Exact
 * ceilings are cheap on small/loosely-constrained gear (finishes well under this) but can
 * be very expensive on large, tightly-constrained pools — there the refinement stops at
 * the budget and reports the best guaranteed-achievable value found so far.
 */
const CEILING_BUDGET_MS = 1200;
/**
 * Wall-clock budget for the top-N build search. Demanding *joint* stat targets can push
 * the combinatorial search into a performance cliff (minutes); past this budget it stops
 * and returns the best builds found so far with `capped: true`. The list shown to the
 * user is FROZEN at whatever this window found (deliberate UX: a list never changes
 * under the reader) — post-cap discovery continues through solveCeilings() in the
 * worker session and surfaces only as the stat sliders' rising max overlays.
 */
const TOPN_BUDGET_MS = 6000;
/** Check the wall clock every this many combos (a power of two for a cheap mask). */
const BUDGET_CHECK_MASK = 65535;
/** Portion of the progress bar covered by the top-N walk; ceilings fill the rest. */
const TOPN_PROGRESS_SHARE = 0.9;
/** Minimum wall-clock gap between progress emissions. */
const PROGRESS_INTERVAL_MS = 100;
/** Number of stat-subset masks for the subset-sum suffix bound (2^NUM_STATS). */
const NUM_MASKS = 1 << NUM_STATS;

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
 * and the ceiling witness harvest. (Feasible-mode witnesses don't dump leftover artifice
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
    const v = clamp(stats[s] + spare);
    if (v > floors[s]) {
      floors[s] = v;
      rose = true;
    }
  }
  return rose;
}

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
): InternalPiece[] {
  const map = new Map<string, InternalPiece>();
  for (const p of pieces) {
    // Two pieces with the same stats but different tuned stats aren't interchangeable
    // (except exotics, whose flexible slot makes the rolled tuned stat irrelevant).
    const tuneKey =
      allowTuning && p.tuning
        ? `${p.exotic ? "X" : p.tuning.tuned}:${p.tuning.offStats.join(".")}`
        : "-";
    const key =
      (p.exotic ? `E${p.hash ?? 0}` : "L") +
      (p.artifice ? "A" : "") +
      (keyIncludesSet ? `|${p.setHash ?? 0}|` : "|") +
      `T${tuneKey}|` +
      p.stats.join(",");
    if (!map.has(key)) {
      map.set(key, makeInternalPiece(p, allowTuning));
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

/** Fixed-capacity min-heap of loadouts keyed by total — the root is the worst kept. */
class TopNHeap {
  private heap: OptimizerLoadout[] = [];
  constructor(private cap: number) {}

  get worst(): number {
    return this.heap.length ? this.heap[0].total : -Infinity;
  }
  full(): boolean {
    return this.heap.length >= this.cap;
  }
  couldInsert(total: number): boolean {
    return !this.full() || total > this.worst;
  }
  insert(loadout: OptimizerLoadout): void {
    if (!this.full()) {
      this.heap.push(loadout);
      this.bubbleUp(this.heap.length - 1);
    } else if (loadout.total > this.heap[0].total) {
      this.heap[0] = loadout;
      this.bubbleDown(0);
    }
  }
  toSorted(): OptimizerLoadout[] {
    return [...this.heap].sort((a, b) => b.total - a.total);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].total >= this.heap[parent].total) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }
  private bubbleDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].total < this.heap[smallest].total) smallest = l;
      if (r < n && this.heap[r].total < this.heap[smallest].total) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

/**
 * Build the per-slot search pool shared by solve() and solveCeilings(): pre-filter
 * pieces the exotic constraint excludes (they can never appear in a valid loadout,
 * but left in the pool they inflate every suffix bound — looser bounds → less
 * pruning — and slot sizes), then dedupe, sorted by total.
 */
function buildSlots(input: OptimizerInput): InternalPiece[][] {
  const reqs = input.setRequirements ?? [];
  const allowTuning = input.allowTuning ?? true;
  const exoticMode = input.exotic?.mode ?? "any";
  const exoticHashes = input.exotic?.hashes;
  const eligible = (p: OptimizerPiece): boolean =>
    !p.exotic ||
    (exoticMode === "none"
      ? false
      : exoticMode !== "specific" ||
        (p.hash !== undefined && !!exoticHashes?.includes(p.hash)));
  return input.slots.map((s) =>
    dedupe(s.filter(eligible), reqs.length > 0, allowTuning).sort(
      (a, b) => b.total - a.total,
    ),
  );
}

/**
 * Find the best loadouts (one piece per slot, ≤1 exotic) that meet the stat
 * minimums (auto-assigning the mod budget) and satisfy all required set bonuses,
 * ranked by total stats. Brute-force enumeration with dedupe + pruning on stat
 * feasibility, set feasibility, and top-N admission.
 */
export interface SolveOptions {
  /** Streams the ceilings as they refine (seed first, then each stat) for UI animation. */
  onCeilings?: (ceilings: number[]) => void;
  /** Streams overall search progress as a 0–1 fraction (throttled), for a progress bar. */
  onProgress?: (fraction: number) => void;
  /** Wall-clock cap for the top-N search (defaults to TOPN_BUDGET_MS). */
  topNBudgetMs?: number;
  /** Wall-clock cap for refining the ceilings past their seeds (defaults to CEILING_BUDGET_MS). */
  ceilingBudgetMs?: number;
  /**
   * Per-stat floor for the ceiling seeds. MUST be proven-achievable for this exact
   * input (e.g. a prior pass's refined ceilings for the SAME query) — the refinement
   * only ever raises the seed, so an unachievable value would be reported back as a
   * ceiling. Lets a re-run skip re-proving what an earlier pass already established
   * and keeps its streamed ceilings from regressing below what the UI showed.
   */
  ceilingSeed?: number[];
  /**
   * Loadouts from a prior (shorter-budget) solve of this exact input, used to pre-fill
   * the top-N heap so the deterministic walk's already-covered prefix is pruned by the
   * admission bound instead of re-evaluated. MUST be valid loadouts for the SAME input
   * — seeding with another query's builds would return them verbatim in the results.
   */
  heapSeed?: OptimizerLoadout[];
}

export function solve(
  input: OptimizerInput,
  opts: SolveOptions = {},
): OptimizerOutput {
  const onCeilings = opts.onCeilings;
  const topNBudgetMs = opts.topNBudgetMs ?? TOPN_BUDGET_MS;
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const min = input.minimums;
  const mods: ModBudget = input.mods ?? { major: 0, minor: 0 };
  const maxModPoints = mods.major * 10 + mods.minor * 5;
  // Build-wide fragment constant, folded into every loadout's effective stats. May be
  // negative. fragUpside = its positive part, added to the top-N bound to keep it admissible.
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const fragUpside = frag.reduce((a: number, v: number) => a + Math.max(0, v), 0);
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const exoticMode = input.exotic?.mode ?? "any";
  const needExotic = exoticMode === "require" || exoticMode === "specific";

  const slots = buildSlots(input);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    return {
      loadouts: [],
      combosTried: 0,
      combosValid: 0,
      ceilings: [0, 0, 0, 0, 0, 0],
      ceilingsExact: true,
      capped: false,
    };
  }

  // buildSlots pre-filtered constraint-ineligible exotics out of the pool, so every
  // remaining exotic counts toward "require"/"specific" — the reachability predicate
  // is just p.exotic (one eligibility rule, encoded once, in buildSlots).
  const { suffixStat, suffixTotal, setSuffix, exoticSuffix, artSuffix, subsetSuffix } =
    computeSuffixBounds(slots, reqs, needExotic, (p) => p.exotic);

  const heap = new TopNHeap(maxResults);
  // Pre-seed from a prior pass over the SAME input (see SolveOptions.heapSeed): the
  // heap starts full at that pass's running bests, so the admission bound immediately
  // prunes the prefix the earlier pass already covered. seededKeys keeps the walk from
  // re-inserting a seeded build as a duplicate (which would evict a unique one).
  const seededKeys = new Set<string>();
  if (opts.heapSeed) {
    for (const lo of opts.heapSeed) {
      heap.insert(lo);
      seededKeys.add(lo.pieceIds.join("|"));
    }
  }
  const sum = new Array(NUM_STATS).fill(0);
  // Best tuning upside per stat from the pieces chosen so far (for canReachMin).
  const sumTuneUp = new Array(NUM_STATS).fill(0);
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const setCounts = new Array(reqs.length).fill(0);
  let runningTotal = 0;
  // Artifice pieces chosen so far — each is a free +3 the bounds must account for.
  // Boxed so the shared joint-min check reads the live count.
  const chosenArt = { n: 0 };
  let combosTried = 0;
  let combosValid = 0;
  // Time cap for the top-N search: past the deadline it stops and reports `capped`.
  const topNStart = performance.now();
  const topNDeadline = topNStart + topNBudgetMs;
  let stopped = false;
  let capped = false;

  // Per-leaf tuning + mod search (scratch lives inside the searcher, allocated once).
  const tuner = createTuningSearcher(frag, mods);

  // Progress: the max of two monotone fractions — the position in the top two slot
  // loops (share of the combo space covered; pruned subtrees count as covered) and
  // elapsed time over the wall-clock budget (the walk can't outlast its deadline, so
  // this keeps the bar moving even when the enumeration sits deep in one subtree).
  const onProgress = opts.onProgress;
  const slot1Len = slots[1].length;
  let idx0 = 0;
  let idx1 = 0;
  let lastProgressAt = 0;
  const emitTopNProgress = (): void => {
    if (!onProgress) return;
    const now = performance.now();
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    const enumFrac = (idx0 + idx1 / slot1Len) / slots[0].length;
    const timeFrac = (now - topNStart) / topNBudgetMs;
    onProgress(Math.min(1, Math.max(enumFrac, timeFrac)) * TOPN_PROGRESS_SHARE);
  };

  const canReachMin = makeJointMinCheck(
    min,
    sum,
    sumTuneUp,
    frag,
    suffixStat,
    subsetSuffix,
    artSuffix,
    maxModPoints,
    chosenArt,
  );
  const canReachSets = (k: number): boolean => {
    for (let r = 0; r < reqs.length; r++) {
      if (setCounts[r] + setSuffix[r][k] < reqs[r].count) return false;
    }
    return true;
  };

  const recurse = (k: number, exoticCount: number): void => {
    if (stopped) return;
    if (k === NUM_SLOTS) {
      combosTried++;
      if ((combosTried & BUDGET_CHECK_MASK) === 0) {
        emitTopNProgress();
        if (performance.now() > topNDeadline) {
          stopped = true;
          capped = true;
          return;
        }
      }
      if (needExotic && exoticCount !== 1) return;
      for (let r = 0; r < reqs.length; r++) {
        if (setCounts[r] < reqs[r].count) return;
      }
      // Leaf gate: a final joint-minimum check before the costly tuning search.
      if (!canReachMin(NUM_SLOTS)) return;

      const best = tuner(chosen, sum, min, "maximize");
      if (!best) return;
      combosValid++;

      if (heap.couldInsert(best.total)) {
        const pieceIds = chosen.map((p) => p.id);
        if (seededKeys.size > 0 && seededKeys.has(pieceIds.join("|"))) return;
        heap.insert({
          pieceIds,
          baseStats: sum.map((v) => Math.min(STAT_CAP, v)),
          stats: best.stats,
          tuningBonus: best.tuningBonus,
          tuning: best.applied,
          modBonus: best.modBonus,
          modsUsed: best.modsUsed,
          artificeBonus: best.artificeBonus,
          artifice: best.artifice,
          total: best.total,
          exotic: exoticCount > 0,
        });
      }
      return;
    }
    if (!canReachMin(k)) return;
    if (!canReachSets(k)) return;
    if (needExotic && exoticCount + exoticSuffix[k] < 1) return;
    if (
      heap.full() &&
      runningTotal +
        suffixTotal[k] +
        maxModPoints +
        (chosenArt.n + artSuffix[k]) * 3 +
        fragUpside <=
        heap.worst
    ) {
      return;
    }

    for (let i = 0; i < slots[k].length; i++) {
      const p = slots[k][i];
      if (k === 0) {
        idx0 = i;
        idx1 = 0;
        emitTopNProgress();
      } else if (k === 1) {
        idx1 = i;
        emitTopNProgress();
      }
      // Exotic-ineligible pieces were pre-filtered from the pool; only the ≤1 rule remains.
      const nextExotic = exoticCount + (p.exotic ? 1 : 0);
      if (nextExotic > 1) continue; // ≤1 exotic per loadout
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] += p.stats[s];
        sumTuneUp[s] += p.tuneStatUpside[s];
      }
      runningTotal += p.total + p.tuneTotalUpside;
      if (p.artifice) chosenArt.n++;
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]++;
      }
      chosen[k] = p;
      recurse(k + 1, nextExotic);
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]--;
      }
      if (p.artifice) chosenArt.n--;
      runningTotal -= p.total + p.tuneTotalUpside;
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] -= p.stats[s];
        sumTuneUp[s] -= p.tuneStatUpside[s];
      }
    }
  };

  recurse(0, 0);
  onProgress?.(TOPN_PROGRESS_SHARE);
  const loadouts = heap.toSorted();
  // Seed each ceiling with the best value already seen among the returned builds — a
  // strong, guaranteed-achievable lower bound that makes the exact ceiling search prune
  // hard (it only explores combos that could beat what the top-N already found). Mods are
  // only auto-assigned to cover target deficits, so a build's stats alone would just echo
  // the targets back; its unspent mod capacity could genuinely be socketed into any ONE
  // stat, so each stat's seed gets the full spare added (still achievable per stat).
  const seed = new Array(NUM_STATS).fill(0);
  for (const lo of loadouts) {
    raiseAchievableFloors(seed, lo.stats, lo.modsUsed, mods);
  }
  if (opts.ceilingSeed) {
    for (let s = 0; s < NUM_STATS; s++) {
      if (opts.ceilingSeed[s] > seed[s]) seed[s] = opts.ceilingSeed[s];
    }
  }
  // Emit the seed immediately as the fast approximate — the animation's first frame —
  // then refine toward the exact ceilings within the time budget.
  onCeilings?.(seed.slice(0, NUM_STATS));
  const ceilingBudgetMs = opts.ceilingBudgetMs ?? CEILING_BUDGET_MS;
  // Ceilings fill the remaining progress share by wall-clock share of their budget —
  // their true cost isn't predictable, but time elapsed is monotonic and bounded.
  const ceilingStart = performance.now();
  const { ceilings, exact: ceilingsExact } = runCeilings(
    input,
    slots,
    seed,
    ceilingBudgetMs,
    onCeilings,
    () =>
      onProgress?.(
        TOPN_PROGRESS_SHARE +
          (1 - TOPN_PROGRESS_SHARE) *
            Math.min(1, (performance.now() - ceilingStart) / ceilingBudgetMs),
      ),
  );
  onProgress?.(1);
  return { loadouts, combosTried, combosValid, ceilings, ceilingsExact, capped };
}

/** Options for {@link solveCeilings} — an object since later steps grow this list. */
export interface SolveCeilingsOptions {
  /** Ceiling updates as they refine (seed first, then per-stat improvements). */
  onCeilings?: (ceilings: number[]) => void;
  /** Fired on every probe completion (and periodically during long probes). */
  onProbe?: () => void;
}

const EMPTY_CEILING_STATS: CeilingStats = {
  probes: 0,
  feasible: 0,
  disproven: 0,
  timedOut: 0,
  nodes: 0,
};

/**
 * Ceilings-only entry for the worker's background refinement after a capped search:
 * recompute the per-stat maxima for `input` under a much larger budget, starting from
 * `seed` — proven-achievable values from an earlier full solve of the SAME input. The
 * build list is deliberately NOT recomputed: the UI freezes whatever list the capped
 * search returned (a list must never change under the reader), so post-cap discovery
 * surfaces only through these rising ceilings.
 */
export function solveCeilings(
  input: OptimizerInput,
  seed: number[],
  budgetMs: number,
  opts: SolveCeilingsOptions = {},
): { ceilings: number[]; exact: boolean; stats: CeilingStats } {
  const slots = buildSlots(input);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    return { ceilings: seed.slice(0, NUM_STATS), exact: false, stats: EMPTY_CEILING_STATS };
  }
  return runCeilings(input, slots, seed, budgetMs, opts.onCeilings, opts.onProbe);
}

/**
 * Instrumentation for a `runCeilings`/`solveCeilings` call — purely observational (never
 * consulted by the solver itself), so later speedups (subset-mask bound, witness harvest,
 * bound carryover) can be judged against a measured baseline instead of vibes.
 * `probes` = binary-search feasibility probes run; `feasible` = probes that found a build;
 * `disproven` = probes that ran to completion without finding one (aborted === false);
 * `timedOut` = probes that hit their fair-share deadline (aborted === true); `nodes` =
 * total DFS nodes visited across every probe. Always `feasible + disproven + timedOut ===
 * probes`.
 */
export interface CeilingStats {
  probes: number;
  feasible: number;
  disproven: number;
  timedOut: number;
  nodes: number;
}

/**
 * Per-stat ceilings for a FEASIBLE query: for each stat `t`, the maximum final value of
 * stat `t` (after fragment + tuning + mods, clamped 0–200) reachable while still meeting
 * the current minimums on the OTHER five stats. Each stat's ceiling is pinned by binary-
 * searching feasibility probes between `seed` (achievable, from the top-N's builds) and
 * the optimistic suffix bound; probes for the six stats are interleaved round-robin under
 * the shared budget (see the scheduling comment below). `exact` reports whether every
 * ceiling was PROVEN (all binary searches converged with no probe timing out); when
 * false the ceilings are guaranteed-achievable lower bounds. An infeasible query (no
 * build meets the minimums) yields zeros.
 */
function runCeilings(
  input: OptimizerInput,
  slots: InternalPiece[][],
  seed: number[],
  budgetMs: number,
  onProgress?: (ceilings: number[]) => void,
  onProbe?: () => void,
): { ceilings: number[]; exact: boolean; stats: CeilingStats } {
  const min = input.minimums;
  const mods: ModBudget = input.mods ?? { major: 0, minor: 0 };
  const maxModPoints = mods.major * 10 + mods.minor * 5;
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const exoticMode = input.exotic?.mode ?? "any";
  const needExotic = exoticMode === "require" || exoticMode === "specific";

  // buildSlots pre-filtered constraint-ineligible exotics (see solve()) — reachability
  // is just p.exotic.
  const { suffixStat, setSuffix, exoticSuffix, artSuffix, subsetSuffix } =
    computeSuffixBounds(slots, reqs, needExotic, (p) => p.exotic);

  const ceiling = seed.slice(0, NUM_STATS);
  const sum = new Array(NUM_STATS).fill(0);
  // Best tuning upside per stat from the pieces chosen so far (keeps the bound admissible).
  const sumTuneUp = new Array(NUM_STATS).fill(0);
  // Artifice pieces chosen so far — each is a free +3 the bounds must account for.
  // Boxed so the shared joint-min check reads the live count.
  const chosenArt = { n: 0 };
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const setCounts = new Array(reqs.length).fill(0);
  // Probe minimums: `min` with one stat temporarily raised during the binary search.
  const probeMins = min.slice(0, NUM_STATS);

  // Per-leaf tuning feasibility probe — the same search the top-N uses, in feasible
  // (first-hit) mode, so the two can never drift apart again.
  const tuner = createTuningSearcher(frag, mods);

  const canReachSets = (k: number): boolean => {
    for (let r = 0; r < reqs.length; r++) {
      if (setCounts[r] + setSuffix[r][k] < reqs[r].count) return false;
    }
    return true;
  };
  // Can every probe minimum still be reached from slot k? The SAME bound as the top-N
  // search (makeJointMinCheck), reading probeMins live as the binary search mutates it —
  // the joint budget check is what keeps UNsatisfiable probes from degenerating into
  // exhaustive walks when two stats are demanding at once.
  const canReachMin = makeJointMinCheck(
    probeMins,
    sum,
    sumTuneUp,
    frag,
    suffixStat,
    subsetSuffix,
    artSuffix,
    maxModPoints,
    chosenArt,
  );

  // Is there any valid loadout meeting `probeMins`? Depth-first, early-exiting at the
  // first one found — so a satisfiable probe returns almost immediately. Proving a probe
  // UNsatisfiable can be expensive, so each probe also bails at its own deadline.
  let probeDeadline = 0;
  let aborted = false;
  let nodes = 0;
  let found = false;
  // The full outcome of the build the probe found (stats + mods used), captured so the
  // probe loop can harvest it into EVERY stat's floor (witness harvest). Null until found.
  let witness: TuningOutcome | null = null;
  // Long probes must still stream progress ticks — probe-completion granularity alone
  // can sit silent for a probe's whole fair share (seconds on hard pools).
  let lastTickAt = 0;
  const TICK_INTERVAL_MS = 250;
  const search = (k: number, exoticCount: number): void => {
    if (aborted) return;
    if ((nodes++ & 2047) === 0) {
      const now = performance.now();
      if (now > probeDeadline) {
        aborted = true;
        return;
      }
      if (onProbe && now - lastTickAt >= TICK_INTERVAL_MS) {
        lastTickAt = now;
        onProbe();
      }
    }
    if (k === NUM_SLOTS) {
      if (needExotic && exoticCount !== 1) return;
      for (let r = 0; r < reqs.length; r++) {
        if (setCounts[r] < reqs[r].count) return;
      }
      const w = tuner(chosen, sum, probeMins, "feasible");
      if (w) {
        found = true;
        witness = w;
      }
      return;
    }
    if (!canReachMin(k)) return;
    if (!canReachSets(k)) return;
    if (needExotic && exoticCount + exoticSuffix[k] < 1) return;
    for (const p of slots[k]) {
      if (found || aborted) return;
      // Exotic-ineligible pieces were pre-filtered from the pool (solve() built `slots`).
      const nextExotic = exoticCount + (p.exotic ? 1 : 0);
      if (nextExotic > 1) continue;
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] += p.stats[s];
        sumTuneUp[s] += p.tuneStatUpside[s];
      }
      if (p.artifice) chosenArt.n++;
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]++;
      }
      chosen[k] = p;
      search(k + 1, nextExotic);
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]--;
      }
      if (p.artifice) chosenArt.n--;
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] -= p.stats[s];
        sumTuneUp[s] -= p.tuneStatUpside[s];
      }
    }
  };
  // Returns the build the probe found (a witness to harvest from), or null if none —
  // `found`/`aborted` still record feasibility vs. timeout for the probe loop.
  const feasible = (deadline: number): TuningOutcome | null => {
    probeDeadline = deadline;
    aborted = false;
    found = false;
    witness = null;
    search(0, 0);
    return witness;
  };

  // For each stat, binary-search the highest value it can reach while the OTHER minimums
  // hold: `ceiling[t]` is the proven-achievable low side, `optimistic[t]` the suffix-bound
  // high side. Probes are scheduled ROUND-ROBIN — one probe per unsettled stat per pass —
  // and each probe is capped at a fair share of the remaining budget. A probe that finds
  // a build raises that stat's ceiling (trusted even if the clock then expired — a found
  // build is proof); a probe that proves infeasibility OR times out shrinks the optimistic
  // bound instead, so the ceiling stays a guaranteed-achievable lower bound. A timed-out
  // shrink is NOT a proof though, so it (like running out of budget with stats
  // unsettled) makes the result inexact — callers must never present inexact ceilings
  // as proven maxima. Fair shares are what keep one expensive impossibility proof from
  // starving every stat scheduled after it (previously sequential refinement reported
  // those stats' raw seeds as maxima).
  const globalDeadline = performance.now() + budgetMs;
  const optimistic = new Array(NUM_STATS).fill(0);
  let exact = true;
  let pending: number[] = [];
  const stats: CeilingStats = { probes: 0, feasible: 0, disproven: 0, timedOut: 0, nodes: 0 };
  for (let t = 0; t < NUM_STATS; t++) {
    optimistic[t] = clamp(frag[t] + suffixStat[0][t] + maxModPoints + artSuffix[0] * 3);
    if (optimistic[t] > ceiling[t]) pending.push(t);
  }
  while (pending.length) {
    const next: number[] = [];
    for (let i = 0; i < pending.length; i++) {
      const t = pending[i];
      // A witness harvest earlier this pass may have already lifted this stat's floor to
      // its optimistic bound — it's settled, so don't probe it (and don't re-queue it or
      // count it as a probe; a skip is not a probe). The share denominator over-counts a
      // skipped stat by one, which only makes later shares slightly smaller (safe); the
      // loop still terminates because `next` never re-adds a settled stat.
      if (ceiling[t] >= optimistic[t]) continue;
      const now = performance.now();
      if (now >= globalDeadline) break;
      const share = (globalDeadline - now) / (pending.length - i + next.length);
      const mid = ceiling[t] + Math.ceil((optimistic[t] - ceiling[t]) / 2);
      probeMins[t] = mid;
      const w = feasible(Math.min(globalDeadline, now + share));
      probeMins[t] = min[t];
      onProbe?.();
      stats.probes++;
      if (w) {
        stats.feasible++;
        ceiling[t] = mid;
        // Witness harvest: the probe replaced min[t] with `mid`, so the witness meets
        // probeMins = (min with position t set to mid). That is a superset of the query's
        // real minimums ONLY when mid >= min[t] — then the witness is a legal build for
        // THIS query and its final stats (plus spare mods dumped into any one stat) are a
        // valid achievable floor for EVERY stat's ceiling, letting a later stat settle
        // without a probe of its own (see the settled-skip guard above). When mid < min[t]
        // (a probe BELOW the user's own minimum, e.g. a stat whose min is unsatisfiable so
        // its ceiling is searched from 0) the witness may violate min[t], so it is NOT a
        // legal build and we must not harvest it into the other stats. `exact` is untouched
        // either way: harvest only lifts the proven low side, never `optimistic`.
        if (mid >= min[t]) {
          raiseAchievableFloors(ceiling, w.stats, w.modsUsed, mods);
        }
        onProgress?.(ceiling.slice(0, NUM_STATS)); // stream each improvement for animation
      } else {
        if (aborted) {
          stats.timedOut++;
          exact = false; // timed out, not disproven — unproven shrink
        } else {
          stats.disproven++;
        }
        optimistic[t] = mid - 1;
      }
      if (ceiling[t] < optimistic[t]) next.push(t);
    }
    if (performance.now() >= globalDeadline) break; // budget spent — keep proven values
    pending = next;
  }
  for (let t = 0; t < NUM_STATS; t++) {
    if (ceiling[t] < optimistic[t]) exact = false; // ran out of budget unsettled
  }
  stats.nodes = nodes;
  return { ceilings: ceiling, exact, stats };
}
