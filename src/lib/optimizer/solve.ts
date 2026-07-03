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
} from "./tuning";
import { paretoWithinGroup } from "./pareto";

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

/**
 * Collapse pieces with an identical stat vector (+ exotic, + set, + tuning) to one
 * representative, then drop Pareto-dominated pieces within each dominance group (same
 * key minus the stat vector — see paretoWithinGroup for the soundness argument). The
 * group key is carved out of the very same expression as the dedupe key so the two can
 * never drift apart.
 */
function dedupe(
  pieces: OptimizerPiece[],
  keyIncludesSet: boolean,
  allowTuning: boolean,
  dominancePruning: boolean,
): InternalPiece[] {
  const seen = new Set<string>();
  const groups = new Map<string, InternalPiece[]>();
  for (const p of pieces) {
    // Two pieces with the same stats but different tuned stats aren't interchangeable
    // (except exotics, whose flexible slot makes the rolled tuned stat irrelevant).
    const tuneKey =
      allowTuning && p.tuning
        ? `${p.exotic ? "X" : p.tuning.tuned}:${p.tuning.offStats.join(".")}`
        : "-";
    const groupKey =
      (p.exotic ? `E${p.hash ?? 0}` : "L") +
      (p.artifice ? "A" : "") +
      (keyIncludesSet ? `|${p.setHash ?? 0}|` : "|") +
      `T${tuneKey}`;
    const fullKey = groupKey + "|" + p.stats.join(",");
    if (seen.has(fullKey)) continue;
    seen.add(fullKey);
    const piece = makeInternalPiece(p, allowTuning);
    const group = groups.get(groupKey);
    if (group) {
      group.push(piece);
    } else {
      groups.set(groupKey, [piece]);
    }
  }
  const out: InternalPiece[] = [];
  for (const group of groups.values()) {
    const kept = dominancePruning ? paretoWithinGroup(group) : group;
    for (const piece of kept) out.push(piece);
  }
  return out;
}

/**
 * Suffix bounds over slots k..4: per-stat max and best-total (both including each
 * piece's best tuning upside, so feasibility/top-N bounds never prune a reachable
 * loadout), per-set reachability, and exotic reachability. Shared by the top-N search
 * and the ceiling probes so the two can't drift apart.
 */
function computeSuffixBounds(
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
  for (let k = NUM_SLOTS - 1; k >= 0; k--) {
    const slotMax = new Array(NUM_STATS).fill(0);
    let slotBestTotal = 0;
    for (const p of slots[k]) {
      for (let s = 0; s < NUM_STATS; s++) {
        const v = p.stats[s] + p.tuneStatUpside[s];
        if (v > slotMax[s]) slotMax[s] = v;
      }
      const t = p.total + p.tuneTotalUpside;
      if (t > slotBestTotal) slotBestTotal = t;
    }
    for (let s = 0; s < NUM_STATS; s++) {
      suffixStat[k][s] = suffixStat[k + 1][s] + slotMax[s];
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
  return { suffixStat, suffixTotal, setSuffix, exoticSuffix, artSuffix };
}

/**
 * Shared joint-feasibility bound for the top-N search and the ceiling probes — the two
 * MUST be the same check (bound drift between the walks is how the over-reported-ceiling
 * class of bug happens). From slot k, every stat's optimistic completion (chosen pieces
 * + best remaining pieces + tuning upside) must reach its minimum, and JOINTLY the mod
 * points needed across all stats must fit the shared budget, widened by +3 per reachable
 * artifice piece. The joint check is what prunes multi-constraint queries early enough
 * to avoid exhaustive walks. `mins` is read live (probes mutate it); `chosenArt.n` is
 * the caller's running artifice count.
 */
function makeJointMinCheck(
  mins: number[],
  sum: number[],
  sumTuneUp: number[],
  frag: number[],
  suffixStat: number[][],
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
      for (let s = 0; s < NUM_STATS; s++) {
        const d = mins[s] - (sum[s] + frag[s] + sumTuneUp[s] + suffixStat[k][s]);
        if (d > 0) {
          needed += deficitPoints(d, false);
          if (needed > maxModPoints) return false;
        }
      }
      return true;
    };
  }
  return (k) => {
    const artUp = chosenArt.n + artSuffix[k];
    const budget = maxModPoints + artUp * 3;
    let needed = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      const d = mins[s] - (sum[s] + frag[s] + sumTuneUp[s] + suffixStat[k][s]);
      if (d > 0) {
        needed += deficitPoints(d, artUp > 0);
        if (needed > budget) return false;
      }
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
 * pruning — and slot sizes), then dedupe + dominance-prune, sorted by total.
 */
function buildSlots(
  input: OptimizerInput,
  dominancePruning: boolean,
): InternalPiece[][] {
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
    dedupe(s.filter(eligible), reqs.length > 0, allowTuning, dominancePruning).sort(
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
   * Drop Pareto-dominated pieces before the search (defaults to true). Never changes
   * the best totals or the exact ceilings — the escape hatch exists only so tests can
   * compare pruned vs unpruned runs and measure the reduction.
   */
  dominancePruning?: boolean;
  /**
   * Per-stat floor for the ceiling seeds. MUST be proven-achievable for this exact
   * input (e.g. a prior pass's refined ceilings for the SAME query) — the refinement
   * only ever raises the seed, so an unachievable value would be reported back as a
   * ceiling. Lets a re-run skip re-proving what an earlier pass already established
   * and keeps its streamed ceilings from regressing below what the UI showed.
   */
  ceilingSeed?: number[];
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
  const exoticHashes = input.exotic?.hashes;
  const needExotic = exoticMode === "require" || exoticMode === "specific";
  // An exotic that counts toward the requirement (any for "require"; a chosen version for "specific").
  const isChosenExotic = (p: InternalPiece): boolean =>
    p.exotic &&
    (exoticMode === "specific"
      ? p.hash !== undefined && !!exoticHashes?.includes(p.hash)
      : true);

  const slots = buildSlots(input, opts.dominancePruning ?? true);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    return {
      loadouts: [],
      combosTried: 0,
      combosValid: 0,
      ceilings: [0, 0, 0, 0, 0, 0],
      capped: false,
    };
  }

  const { suffixStat, suffixTotal, setSuffix, exoticSuffix, artSuffix } =
    computeSuffixBounds(slots, reqs, needExotic, isChosenExotic);

  const heap = new TopNHeap(maxResults);
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
        heap.insert({
          pieceIds: chosen.map((p) => p.id),
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
    const spare =
      (mods.major - lo.modsUsed.major) * 10 + (mods.minor - lo.modsUsed.minor) * 5;
    for (let s = 0; s < NUM_STATS; s++) {
      const v = clamp(lo.stats[s] + spare);
      if (v > seed[s]) seed[s] = v;
    }
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
  const ceilings = runCeilings(input, slots, seed, ceilingBudgetMs, onCeilings, () =>
    onProgress?.(
      TOPN_PROGRESS_SHARE +
        (1 - TOPN_PROGRESS_SHARE) *
          Math.min(1, (performance.now() - ceilingStart) / ceilingBudgetMs),
    ),
  );
  onProgress?.(1);
  return { loadouts, combosTried, combosValid, ceilings, capped };
}

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
  onCeilings?: (ceilings: number[]) => void,
  onProbe?: () => void,
): number[] {
  const slots = buildSlots(input, true);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    return seed.slice(0, NUM_STATS);
  }
  return runCeilings(input, slots, seed, budgetMs, onCeilings, onProbe);
}

/**
 * Per-stat ceilings for a FEASIBLE query: for each stat `t`, the maximum final value of
 * stat `t` (after fragment + tuning + mods, clamped 0–200) reachable while still meeting
 * the current minimums on the OTHER five stats. Each stat's ceiling is pinned by binary-
 * searching feasibility probes between `seed` (achievable, from the top-N's builds) and
 * the optimistic suffix bound; probes for the six stats are interleaved round-robin under
 * the shared budget (see the scheduling comment below). Exact when the probes fit the
 * budget, otherwise a guaranteed-achievable lower bound. An infeasible query (no build
 * meets the minimums) yields zeros.
 */
function runCeilings(
  input: OptimizerInput,
  slots: InternalPiece[][],
  seed: number[],
  budgetMs: number,
  onProgress?: (ceilings: number[]) => void,
  onProbe?: () => void,
): number[] {
  const min = input.minimums;
  const mods: ModBudget = input.mods ?? { major: 0, minor: 0 };
  const maxModPoints = mods.major * 10 + mods.minor * 5;
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const exoticMode = input.exotic?.mode ?? "any";
  const exoticHashes = input.exotic?.hashes;
  const needExotic = exoticMode === "require" || exoticMode === "specific";
  const isChosenExotic = (p: InternalPiece): boolean =>
    p.exotic &&
    (exoticMode === "specific"
      ? p.hash !== undefined && !!exoticHashes?.includes(p.hash)
      : true);

  const { suffixStat, setSuffix, exoticSuffix, artSuffix } = computeSuffixBounds(
    slots,
    reqs,
    needExotic,
    isChosenExotic,
  );

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
  const search = (k: number, exoticCount: number): void => {
    if (aborted) return;
    if ((nodes++ & 2047) === 0 && performance.now() > probeDeadline) {
      aborted = true;
      return;
    }
    if (k === NUM_SLOTS) {
      if (needExotic && exoticCount !== 1) return;
      for (let r = 0; r < reqs.length; r++) {
        if (setCounts[r] < reqs[r].count) return;
      }
      if (tuner(chosen, sum, probeMins, "feasible")) found = true;
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
  const feasible = (deadline: number): boolean => {
    probeDeadline = deadline;
    aborted = false;
    found = false;
    search(0, 0);
    return found;
  };

  // For each stat, binary-search the highest value it can reach while the OTHER minimums
  // hold: `ceiling[t]` is the proven-achievable low side, `optimistic[t]` the suffix-bound
  // high side. Probes are scheduled ROUND-ROBIN — one probe per unsettled stat per pass —
  // and each probe is capped at a fair share of the remaining budget. A probe that finds
  // a build raises that stat's ceiling (trusted even if the clock then expired — a found
  // build is proof); a probe that proves infeasibility OR times out shrinks the optimistic
  // bound instead, so the ceiling stays a guaranteed-achievable lower bound. Fair shares
  // are what keep one expensive impossibility proof from starving every stat scheduled
  // after it (previously sequential refinement reported those stats' raw seeds as maxima).
  const globalDeadline = performance.now() + budgetMs;
  const optimistic = new Array(NUM_STATS).fill(0);
  let pending: number[] = [];
  for (let t = 0; t < NUM_STATS; t++) {
    optimistic[t] = clamp(frag[t] + suffixStat[0][t] + maxModPoints + artSuffix[0] * 3);
    if (optimistic[t] > ceiling[t]) pending.push(t);
  }
  while (pending.length) {
    const next: number[] = [];
    for (let i = 0; i < pending.length; i++) {
      const t = pending[i];
      const now = performance.now();
      if (now >= globalDeadline) break;
      const share = (globalDeadline - now) / (pending.length - i + next.length);
      const mid = ceiling[t] + Math.ceil((optimistic[t] - ceiling[t]) / 2);
      probeMins[t] = mid;
      const ok = feasible(Math.min(globalDeadline, now + share));
      probeMins[t] = min[t];
      onProbe?.();
      if (ok) {
        ceiling[t] = mid;
        onProgress?.(ceiling.slice(0, NUM_STATS)); // stream each improvement for animation
      } else {
        optimistic[t] = mid - 1;
      }
      if (ceiling[t] < optimistic[t]) next.push(t);
    }
    if (performance.now() >= globalDeadline) break; // budget spent — keep proven values
    pending = next;
  }
  return ceiling;
}
