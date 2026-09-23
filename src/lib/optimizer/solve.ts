import type {
  ModBudget,
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  SetRequirement,
} from "./types";
import { NUM_SLOTS, NUM_STATS, STAT_CAP, raiseAchievableFloors } from "./floors";
import {
  createTuningSearcher,
  type InternalPiece,
} from "./tuning";
import {
  buildSlots,
  computeSuffixBounds,
  makeAdmissionBound,
  makeJointMinCheck,
  nextExoticCount,
} from "./bounds";
import { CEILING_BUDGET_MS, runCeilings } from "./ceilings";
import { createPowerTracker, loadoutPower } from "./power";

const DEFAULT_MAX_RESULTS = 200;
/**
 * Wall-clock budget for the top-N build search. Demanding *joint* stat targets can push
 * the combinatorial search into a performance cliff (minutes); past this budget it stops
 * and returns the best builds found so far with `capped: true`. The list shown to the
 * user is FROZEN at whatever this window found (deliberate UX: a list never changes
 * under the reader) — post-cap discovery continues through solveCeilings() in the
 * worker session and surfaces only as the stat sliders' rising max overlays.
 */
const TOPN_BUDGET_MS = 6000;
/**
 * Check the wall clock every this many search NODES (a power of two for a cheap mask).
 * Nodes, not leaves: a walk that prunes at depth 4 can visit millions of internal
 * nodes without ever reaching a leaf, so a leaf-only check could run unbounded past
 * the budget. The leaf tuner ticks the same check from inside long directional
 * searches (see createTuningSearcher's `onTick`).
 */
const BUDGET_CHECK_MASK = 65535;
/** Portion of the progress bar covered by the top-N walk; ceilings fill the rest. */
const TOPN_PROGRESS_SHARE = 0.9;
/** Minimum wall-clock gap between progress emissions. */
const PROGRESS_INTERVAL_MS = 100;

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
   * Per-stat PROVEN upper bounds on the ceilings from a prior pass over this EXACT input
   * (its `ceilingUppers`) — MUST be genuine proven bounds, same trust contract as
   * `ceilingSeed`: a value too low would clamp a real ceiling shut. Lets a re-run start
   * each stat's binary search with the upper side already narrowed (often already closed),
   * so the background pass doesn't re-prove what an earlier pass established.
   */
  ceilingUpperSeed?: number[];
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
  // negative; its share of the top-N bound is fragUpside (see fragmentCredit).
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const exoticMode = input.exotic?.mode ?? "any";
  const needExotic = exoticMode === "require" || exoticMode === "specific";

  const slots = buildSlots(input);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    return {
      loadouts: [],
      combosTried: 0,
      combosValid: 0,
      combosValidExact: true,
      ceilings: [0, 0, 0, 0, 0, 0],
      ceilingUppers: [0, 0, 0, 0, 0, 0],
      ceilingsExact: true,
      capped: false,
    };
  }

  // buildSlots pre-filtered constraint-ineligible exotics out of the pool, so every
  // remaining exotic counts toward "require"/"specific" — the reachability predicate
  // is just p.exotic (one eligibility rule, encoded once, in buildSlots). The top-N
  // options tighten the per-piece tuning credit inside suffixTotal for this query.
  const suffix = computeSuffixBounds(slots, reqs, needExotic, (p) => p.exotic, {
    frag,
    mins: min,
  });
  const { suffixStat, setSuffix, exoticSuffix, artSuffix, subsetSuffix } = suffix;

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
  // Worst tuning downside per stat from the pieces chosen so far (for the mod-slack bound).
  const sumTuneDown = new Array(NUM_STATS).fill(0);
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const setCounts = new Array(reqs.length).fill(0);
  // Artifice pieces chosen so far — each is a free +3 the bounds must account for.
  // Boxed so the shared joint-min check reads the live count.
  const chosenArt = { n: 0 };
  let combosTried = 0;
  let combosValid = 0;
  // Set once the admission bound cuts any subtree: from then on combosValid undercounts.
  let boundPruned = false;
  // Time cap for the top-N search: past the deadline it stops and reports `capped`.
  const topNStart = performance.now();
  const topNDeadline = topNStart + topNBudgetMs;
  let stopped = false;
  let capped = false;
  let nodes = 0;
  // Armor power range (null when none is set, so the walk skips the calls).
  const power = createPowerTracker(slots, input.powerRange);

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
  // The one budget check: from the walk (every BUDGET_CHECK_MASK+1 nodes) and from
  // inside the leaf tuner's directional search. Stopping mid-leaf is safe — the tuner
  // finishes its leaf (bounded work) and the walk stops at the next node.
  const checkBudget = (): void => {
    emitTopNProgress();
    if (performance.now() > topNDeadline) {
      stopped = true;
      capped = true;
    }
  };

  // Per-leaf tuning + mod search (scratch lives inside the searcher, allocated once).
  const tuner = createTuningSearcher(frag, mods, checkBudget);

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
  // Top-N admission bound from slot k (see makeAdmissionBound). A subtree whose bound
  // can't beat the heap's worst is skipped (admission is strict, so a tie can't enter
  // either).
  const admission = makeAdmissionBound(
    slots,
    suffix,
    min,
    sum,
    frag,
    sumTuneDown,
    maxModPoints,
    chosenArt,
  );
  const cannotBeatWorst = (k: number): boolean => {
    if (!heap.full() || !admission.cannotBeat(k, heap.worst)) return false;
    boundPruned = true;
    return true;
  };

  const recurse = (k: number, exoticCount: number): void => {
    if (stopped) return;
    if ((++nodes & BUDGET_CHECK_MASK) === 0) {
      checkBudget();
      if (stopped) return;
    }
    if (k === NUM_SLOTS) {
      combosTried++;
      if (needExotic && exoticCount !== 1) return;
      for (let r = 0; r < reqs.length; r++) {
        if (setCounts[r] < reqs[r].count) return;
      }
      if (power && !power.feasible(NUM_SLOTS)) return;
      // Leaf gates: a final joint-minimum check and the admission bound (suffix = 0)
      // before the costly tuning search — a leaf that can't enter the heap isn't tuned.
      if (!canReachMin(NUM_SLOTS)) return;
      if (cannotBeatWorst(NUM_SLOTS)) return;

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
          power: loadoutPower(chosen, input.powerRange?.weapons),
        });
      }
      return;
    }
    if (!canReachMin(k)) return;
    if (!canReachSets(k)) return;
    if (needExotic && exoticCount + exoticSuffix[k] < 1) return;
    if (power && !power.feasible(k)) return;
    if (cannotBeatWorst(k)) return;

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
      const nextExotic = nextExoticCount(exoticCount, p, k, needExotic, exoticSuffix);
      if (nextExotic < 0) continue;
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] += p.stats[s];
        sumTuneUp[s] += p.tuneStatUpside[s];
        sumTuneDown[s] += p.tuneStatDownside[s];
      }
      admission.push(k, i);
      if (p.artifice) chosenArt.n++;
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]++;
      }
      power?.push(p);
      chosen[k] = p;
      recurse(k + 1, nextExotic);
      power?.pop(p);
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]--;
      }
      if (p.artifice) chosenArt.n--;
      admission.pop(k, i);
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] -= p.stats[s];
        sumTuneUp[s] -= p.tuneStatUpside[s];
        sumTuneDown[s] -= p.tuneStatDownside[s];
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
  const {
    ceilings,
    uppers: ceilingUppers,
    exact: ceilingsExact,
  } = runCeilings(input, slots, seed, ceilingBudgetMs, {
    upperSeed: opts.ceilingUpperSeed,
    onCeilings,
    onProbe: () =>
      onProgress?.(
        TOPN_PROGRESS_SHARE +
          (1 - TOPN_PROGRESS_SHARE) *
            Math.min(1, (performance.now() - ceilingStart) / ceilingBudgetMs),
      ),
  });
  onProgress?.(1);
  return {
    loadouts,
    combosTried,
    combosValid,
    combosValidExact: !boundPruned,
    ceilings,
    ceilingUppers,
    ceilingsExact,
    capped,
  };
}
