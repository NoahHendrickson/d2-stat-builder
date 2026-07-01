import type {
  AppliedTuning,
  ModBudget,
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  OptimizerPiece,
  PieceTuning,
  SetRequirement,
} from "./types";

const NUM_STATS = 6;
const NUM_SLOTS = 5;
const STAT_CAP = 200;
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
 * and returns the best builds found so far with `capped: true`.
 */
const TOPN_BUDGET_MS = 4000;
/** Check the wall clock every this many combos (a power of two for a cheap mask). */
const BUDGET_CHECK_MASK = 65535;

const clamp = (v: number): number => (v < 0 ? 0 : v > STAT_CAP ? STAT_CAP : v);

/** One tuning choice for a piece: its per-stat delta and what to record if picked. */
interface TuneOption {
  vec: number[];
  applied: AppliedTuning | null;
}

interface InternalPiece {
  id: string;
  stats: number[];
  exotic: boolean;
  hash?: number;
  setHash?: number;
  total: number;
  /** Index of the rolled tuned stat (the +5 target), or -1 if the piece can't be tuned. */
  tuned: number;
  /** Tuning choices the optimizer may pick from (always ≥1 — the no-tune option). */
  tuneOpts: TuneOption[];
  /** Best positive tuning contribution reachable per stat (for admissible pruning). */
  tuneStatUpside: number[];
  /** Best total tuning contribution reachable (Balanced = +3; else 0). */
  tuneTotalUpside: number;
}

function statTotal(stats: number[]): number {
  let t = 0;
  for (let i = 0; i < NUM_STATS; i++) t += stats[i];
  return t;
}

/**
 * Every tuning option for a piece: no-tune only when it can't be tuned (or tuning is
 * off), else Balanced (+1 to each off-archetype stat) plus directionals (+5 to a tuned
 * stat, −5 to another). "No tune" is omitted for tunable pieces because Balanced weakly
 * dominates it (pure upside, no downside).
 *
 * Legendaries can only put the +5 on their one rolled tuned stat. Tier-5 EXOTICS have a
 * flexible tuning slot — their +5 can go to ANY stat — so we generate a directional for
 * every (+stat, −stat) pair.
 */
function buildTuneOpts(
  tuning: PieceTuning | undefined,
  allow: boolean,
  isExotic: boolean,
): TuneOption[] {
  if (!allow || !tuning) return [{ vec: [0, 0, 0, 0, 0, 0], applied: null }];
  const opts: TuneOption[] = [];
  const balanced = [0, 0, 0, 0, 0, 0];
  for (const s of tuning.offStats) balanced[s] += 1;
  opts.push({ vec: balanced, applied: { kind: "balanced" } });
  const plusStats = isExotic ? [0, 1, 2, 3, 4, 5] : [tuning.tuned];
  for (const plus of plusStats) {
    for (let j = 0; j < NUM_STATS; j++) {
      if (j === plus) continue;
      const vec = [0, 0, 0, 0, 0, 0];
      vec[plus] += 5;
      vec[j] -= 5;
      opts.push({ vec, applied: { kind: "directional", plus, minus: j } });
    }
  }
  return opts;
}

/** Collapse pieces with an identical stat vector (+ exotic, + set, + tuning) to one representative. */
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
      (keyIncludesSet ? `|${p.setHash ?? 0}|` : "|") +
      `T${tuneKey}|` +
      p.stats.join(",");
    if (!map.has(key)) {
      const tuneOpts = buildTuneOpts(p.tuning, allowTuning, p.exotic);
      const tuneStatUpside = new Array(NUM_STATS).fill(0);
      let tuneTotalUpside = 0;
      for (const opt of tuneOpts) {
        let optTotal = 0;
        for (let s = 0; s < NUM_STATS; s++) {
          if (opt.vec[s] > tuneStatUpside[s]) tuneStatUpside[s] = opt.vec[s];
          optTotal += opt.vec[s];
        }
        if (optTotal > tuneTotalUpside) tuneTotalUpside = optTotal;
      }
      map.set(key, {
        id: p.id,
        stats: p.stats,
        exotic: p.exotic,
        hash: p.hash,
        setHash: p.setHash,
        total: statTotal(p.stats),
        tuned: allowTuning && p.tuning ? p.tuning.tuned : -1,
        tuneOpts,
        tuneStatUpside,
        tuneTotalUpside,
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Cheapest assignment of major (+10) / minor (+5) stat mods covering every stat's
 * deficit within the budget. Returns per-stat points + counts, or null if infeasible.
 */
export function assignMods(
  deficits: number[],
  maxMajor: number,
  maxMinor: number,
): { points: number[]; usedMajor: number; usedMinor: number } | null {
  const major = new Array(NUM_STATS).fill(0);
  const minor = new Array(NUM_STATS).fill(0);

  const rec = (s: number, majorsLeft: number, minorsLeft: number): boolean => {
    if (s === NUM_STATS) return true;
    const need = deficits[s];
    if (need <= 0) return rec(s + 1, majorsLeft, minorsLeft);
    const maxA = Math.min(majorsLeft, Math.ceil(need / 10));
    for (let a = maxA; a >= 0; a--) {
      const remainder = need - a * 10;
      const b = remainder > 0 ? Math.ceil(remainder / 5) : 0;
      if (b > minorsLeft) continue;
      major[s] = a;
      minor[s] = b;
      if (rec(s + 1, majorsLeft - a, minorsLeft - b)) return true;
    }
    major[s] = 0;
    minor[s] = 0;
    return false;
  };

  if (!rec(0, maxMajor, maxMinor)) return null;
  const points = major.map((a, i) => a * 10 + minor[i] * 5);
  return {
    points,
    usedMajor: major.reduce((x, y) => x + y, 0),
    usedMinor: minor.reduce((x, y) => x + y, 0),
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
 * Find the best loadouts (one piece per slot, ≤1 exotic) that meet the stat
 * minimums (auto-assigning the mod budget) and satisfy all required set bonuses,
 * ranked by total stats. Brute-force enumeration with dedupe + pruning on stat
 * feasibility, set feasibility, and top-N admission.
 */
export interface SolveOptions {
  /** Streams the ceilings as they refine (seed first, then each stat) for UI animation. */
  onCeilings?: (ceilings: number[]) => void;
  /** Wall-clock cap for the top-N search (defaults to TOPN_BUDGET_MS). */
  topNBudgetMs?: number;
  /** Wall-clock cap for refining the ceilings past their seeds (defaults to CEILING_BUDGET_MS). */
  ceilingBudgetMs?: number;
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
  const allowTuning = input.allowTuning ?? true;
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

  const slots = input.slots.map((s) =>
    dedupe(s, reqs.length > 0, allowTuning).sort((a, b) => b.total - a.total),
  );
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    return {
      loadouts: [],
      combosTried: 0,
      combosValid: 0,
      ceilings: [0, 0, 0, 0, 0, 0],
      capped: false,
    };
  }

  // Suffix bounds for slots k..4: per-stat max, best-total, and per-set reachability.
  const suffixStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  const suffixTotal = new Array(NUM_SLOTS + 1).fill(0);
  // setSuffix[r][k] = number of slots in k..4 that contain ≥1 piece of reqs[r].setHash.
  const setSuffix = reqs.map(() => new Array(NUM_SLOTS + 1).fill(0));
  const exoticSuffix = new Array(NUM_SLOTS + 1).fill(0);
  for (let k = NUM_SLOTS - 1; k >= 0; k--) {
    // slotMax / slotBestTotal include the best tuning upside a piece could add,
    // so the feasibility and top-N bounds never prune a reachable loadout.
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
  }

  const heap = new TopNHeap(maxResults);
  const sum = new Array(NUM_STATS).fill(0);
  // Best tuning upside per stat from the pieces chosen so far (for canReachMin).
  const sumTuneUp = new Array(NUM_STATS).fill(0);
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const setCounts = new Array(reqs.length).fill(0);
  let runningTotal = 0;
  let combosTried = 0;
  let combosValid = 0;
  // Time cap for the top-N search: past the deadline it stops and reports `capped`.
  const topNDeadline = performance.now() + topNBudgetMs;
  let stopped = false;
  let capped = false;

  // Reused scratch for the per-leaf tuning search.
  const aug = new Array(NUM_STATS).fill(0);
  const deficits = new Array(NUM_STATS).fill(0);
  const curApplied: (AppliedTuning | null)[] = new Array(NUM_SLOTS).fill(null);
  // suffixUp[i][s] = max tuning upside to stat s reachable from chosen pieces i..4.
  const suffixUp: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  // Which stats Balanced left short (so a directional on a piece tuned to that stat can help).
  const shortStat: boolean[] = new Array(NUM_STATS).fill(false);

  // Feasibility bound: per stat, the optimistic completion (best remaining pieces +
  // tuning upside) must reach the minimum with mods — and JOINTLY, the mod points needed
  // across all stats (each deficit rounded up to the 5-point mod grain) must fit the
  // shared budget. The joint check is what prunes multi-constraint queries (e.g. weapon
  // AND grenade both demanding) early enough to avoid exhaustive walks.
  const canReachMin = (k: number): boolean => {
    let needed = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      const d = min[s] - (sum[s] + frag[s] + sumTuneUp[s] + suffixStat[k][s]);
      if (d > 0) {
        needed += Math.ceil(d / 5) * 5;
        if (needed > maxModPoints) return false;
      }
    }
    return true;
  };
  const canReachSets = (k: number): boolean => {
    for (let r = 0; r < reqs.length; r++) {
      if (setCounts[r] + setSuffix[r][k] < reqs[r].count) return false;
    }
    return true;
  };

  /**
   * Pick the tuning (+ mods) for a full loadout. Model (confirmed with Noah): every
   * tunable piece takes Balanced (+1 to each off-archetype stat) as free upside, and a
   * directional tune (+5 tuned / −5 chosen) is spent only to bridge a minimum that
   * Balanced can't reach. So Balanced-everywhere is the answer whenever it already meets
   * the minimums (the common, O(pieces) case); only when it falls short is the directional
   * search run. The pruned search is cross-checked against a brute force in the bench.
   */
  const optimizeTuning = (): {
    total: number;
    stats: number[];
    tuningBonus: number[];
    applied: (AppliedTuning | null)[];
    modBonus: number[];
    modsUsed: { major: number; minor: number };
  } | null => {
    // Fast path: Balanced on every tunable piece (tuneOpts[0] is Balanced, or the
    // no-tune option for a piece that can't be tuned). If that already clears the
    // minimums, it's this loadout's best tuning — return without touching directionals.
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const bal = chosen[i].tuneOpts[0];
      curApplied[i] = bal.applied;
      for (let s = 0; s < NUM_STATS; s++) aug[s] += bal.vec[s];
    }
    for (let s = 0; s < NUM_STATS; s++) deficits[s] = Math.max(0, min[s] - aug[s]);
    const balAsg = assignMods(deficits, mods.major, mods.minor);
    if (balAsg) {
      const stats = new Array<number>(NUM_STATS);
      const tuningBonus = new Array<number>(NUM_STATS);
      let total = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        tuningBonus[s] = aug[s] - sum[s] - frag[s];
        stats[s] = clamp(aug[s] + balAsg.points[s]);
        total += stats[s];
      }
      return {
        total,
        stats,
        tuningBonus,
        applied: curApplied.slice(),
        modBonus: balAsg.points.slice(),
        modsUsed: { major: balAsg.usedMajor, minor: balAsg.usedMinor },
      };
    }

    // Slow path: Balanced falls short of a minimum — search tuning combinations for the
    // highest-total feasible one (branch-and-bound, Balanced enumerated first per piece).
    interface Winner {
      total: number;
      modBonus: number[];
      usedMajor: number;
      usedMinor: number;
      applied: (AppliedTuning | null)[];
      tuningBonus: number[];
    }
    const box: { winner: Winner | null } = { winner: null };

    // `deficits` still holds Balanced's shortfall — a directional only helps a short stat.
    for (let s = 0; s < NUM_STATS; s++) shortStat[s] = deficits[s] > 0;
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let s = 0; s < NUM_STATS; s++) suffixUp[NUM_SLOTS][s] = 0;
    for (let i = NUM_SLOTS - 1; i >= 0; i--) {
      for (let s = 0; s < NUM_STATS; s++) {
        suffixUp[i][s] = suffixUp[i + 1][s] + chosen[i].tuneStatUpside[s];
      }
    }

    const rec = (i: number): void => {
      // Joint-feasibility prune: even with the best remaining tuning upside, if the mod
      // points needed to close every stat's deficit (each rounded up to the 5-point mod
      // grain) exceed the SHARED budget, this branch is dead. (The top-N bounds are
      // per-stat, so this joint check is what cuts the demanding-target cliff.)
      let needed = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const d = min[s] - (aug[s] + suffixUp[i][s]);
        if (d > 0) {
          needed += Math.ceil(d / 5) * 5;
          if (needed > maxModPoints) return;
        }
      }
      // Branch-and-bound: clamp(x+m) ≤ clamp(x)+m, so this over-estimates the best
      // total still reachable from here. Balanced is enumerated first (highest total),
      // seeding a strong bound that prunes directional branches (feasibility-only).
      const w = box.winner;
      if (w) {
        let ub = maxModPoints;
        for (let s = 0; s < NUM_STATS; s++) ub += clamp(aug[s] + suffixUp[i][s]);
        if (ub <= w.total) return;
      }
      if (i === NUM_SLOTS) {
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = Math.max(0, min[s] - aug[s]);
        }
        const asg = assignMods(deficits, mods.major, mods.minor);
        if (!asg) return;
        let total = 0;
        for (let s = 0; s < NUM_STATS; s++) total += clamp(aug[s] + asg.points[s]);
        if (!box.winner || total > box.winner.total) {
          const tuningBonus = new Array<number>(NUM_STATS);
          for (let s = 0; s < NUM_STATS; s++) tuningBonus[s] = aug[s] - sum[s] - frag[s];
          box.winner = {
            total,
            modBonus: asg.points.slice(),
            usedMajor: asg.usedMajor,
            usedMinor: asg.usedMinor,
            applied: curApplied.slice(),
            tuningBonus,
          };
        }
        return;
      }
      // A directional only helps if this piece is tuned to a still-short stat; otherwise
      // Balanced (opts[0]) dominates it, so don't branch the directionals. Exotics are
      // flexible — they can put +5 into any short stat — so always branch their options.
      const opts = chosen[i].tuneOpts;
      const t = chosen[i].tuned;
      const limit = chosen[i].exotic || (t >= 0 && shortStat[t]) ? opts.length : 1;
      for (let o = 0; o < limit; o++) {
        const opt = opts[o];
        curApplied[i] = opt.applied;
        for (let s = 0; s < NUM_STATS; s++) aug[s] += opt.vec[s];
        rec(i + 1);
        for (let s = 0; s < NUM_STATS; s++) aug[s] -= opt.vec[s];
      }
    };
    rec(0);

    const winner = box.winner;
    if (!winner) return null;
    const stats = new Array<number>(NUM_STATS);
    for (let s = 0; s < NUM_STATS; s++) {
      stats[s] = clamp(sum[s] + frag[s] + winner.tuningBonus[s] + winner.modBonus[s]);
    }
    return {
      total: winner.total,
      stats,
      tuningBonus: winner.tuningBonus,
      applied: winner.applied,
      modBonus: winner.modBonus,
      modsUsed: { major: winner.usedMajor, minor: winner.usedMinor },
    };
  };

  const recurse = (k: number, exoticCount: number): void => {
    if (stopped) return;
    if (k === NUM_SLOTS) {
      combosTried++;
      if ((combosTried & BUDGET_CHECK_MASK) === 0 && performance.now() > topNDeadline) {
        stopped = true;
        capped = true;
        return;
      }
      if (needExotic && exoticCount !== 1) return;
      for (let r = 0; r < reqs.length; r++) {
        if (setCounts[r] < reqs[r].count) return;
      }
      // Leaf gate: a final joint-minimum check before the costly tuning search.
      if (!canReachMin(NUM_SLOTS)) return;

      const best = optimizeTuning();
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
      runningTotal + suffixTotal[k] + maxModPoints + fragUpside <= heap.worst
    ) {
      return;
    }

    for (const p of slots[k]) {
      if (exoticMode === "none" && p.exotic) continue;
      if (exoticMode === "specific" && p.exotic && !isChosenExotic(p)) continue;
      const nextExotic = exoticCount + (p.exotic ? 1 : 0);
      if (nextExotic > 1) continue; // ≤1 exotic per loadout
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] += p.stats[s];
        sumTuneUp[s] += p.tuneStatUpside[s];
      }
      runningTotal += p.total + p.tuneTotalUpside;
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]++;
      }
      chosen[k] = p;
      recurse(k + 1, nextExotic);
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]--;
      }
      runningTotal -= p.total + p.tuneTotalUpside;
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] -= p.stats[s];
        sumTuneUp[s] -= p.tuneStatUpside[s];
      }
    }
  };

  recurse(0, 0);
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
  // Emit the seed immediately as the fast approximate — the animation's first frame —
  // then refine toward the exact ceilings within the time budget.
  onCeilings?.(seed.slice(0, NUM_STATS));
  const ceilings = runCeilings(
    input,
    slots,
    seed,
    opts.ceilingBudgetMs ?? CEILING_BUDGET_MS,
    onCeilings,
  );
  return { loadouts, combosTried, combosValid, ceilings, capped };
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

  // Suffix bounds (per-stat max incl. tuning upside, plus set/exotic reachability).
  const suffixStat: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  const setSuffix = reqs.map(() => new Array(NUM_SLOTS + 1).fill(0));
  const exoticSuffix = new Array(NUM_SLOTS + 1).fill(0);
  for (let k = NUM_SLOTS - 1; k >= 0; k--) {
    const slotMax = new Array(NUM_STATS).fill(0);
    for (const p of slots[k]) {
      for (let s = 0; s < NUM_STATS; s++) {
        const v = p.stats[s] + p.tuneStatUpside[s];
        if (v > slotMax[s]) slotMax[s] = v;
      }
    }
    for (let s = 0; s < NUM_STATS; s++) {
      suffixStat[k][s] = suffixStat[k + 1][s] + slotMax[s];
    }
    for (let r = 0; r < reqs.length; r++) {
      const has = slots[k].some((p) => p.setHash === reqs[r].setHash) ? 1 : 0;
      setSuffix[r][k] = setSuffix[r][k + 1] + has;
    }
    if (needExotic) {
      const has = slots[k].some(isChosenExotic) ? 1 : 0;
      exoticSuffix[k] = exoticSuffix[k + 1] + has;
    }
  }

  const ceiling = seed.slice(0, NUM_STATS);
  const sum = new Array(NUM_STATS).fill(0);
  // Best tuning upside per stat from the pieces chosen so far (keeps the bound admissible).
  const sumTuneUp = new Array(NUM_STATS).fill(0);
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const setCounts = new Array(reqs.length).fill(0);
  const deficits = new Array(NUM_STATS).fill(0);
  const aug = new Array(NUM_STATS).fill(0);
  const shortStat: boolean[] = new Array(NUM_STATS).fill(false);
  // suffixUp[i][s] = max tuning upside to stat s reachable from chosen pieces i..4.
  const suffixUp: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  // Probe minimums: `min` with one stat temporarily raised during the binary search.
  const probeMins = min.slice(0, NUM_STATS);

  const canReachSets = (k: number): boolean => {
    for (let r = 0; r < reqs.length; r++) {
      if (setCounts[r] + setSuffix[r][k] < reqs[r].count) return false;
    }
    return true;
  };
  // Can every probe minimum still be reached from slot k? Same admissible bound as the
  // top-N search's canReachMin: per-stat optimistic completion, plus the JOINT check that
  // all mod-point deficits (rounded up to the 5-point grain) fit the shared mod budget —
  // that joint check is what keeps UNsatisfiable probes from degenerating into exhaustive
  // walks when two stats are demanding at once (the probed stat + a held minimum).
  const canReachMin = (k: number): boolean => {
    let needed = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      const d = probeMins[s] - (sum[s] + frag[s] + sumTuneUp[s] + suffixStat[k][s]);
      if (d > 0) {
        needed += Math.ceil(d / 5) * 5;
        if (needed > maxModPoints) return false;
      }
    }
    return true;
  };

  // Does the current complete loadout meet every probe minimum with some tuning + mods?
  // Balanced-everywhere first (the common case); if a stat is still short, branch the
  // directionals of pieces tuned to a short stat — the same reduction optimizeTuning uses.
  let leafOk = false;
  const leafFeasible = (): boolean => {
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const b = chosen[i].tuneOpts[0].vec;
      for (let s = 0; s < NUM_STATS; s++) aug[s] += b[s];
    }
    for (let s = 0; s < NUM_STATS; s++) {
      deficits[s] = Math.max(0, probeMins[s] - aug[s]);
    }
    if (assignMods(deficits, mods.major, mods.minor)) return true;
    for (let s = 0; s < NUM_STATS; s++) shortStat[s] = deficits[s] > 0;
    // Undo the fast path's Balanced accumulation before the directional search: rec()
    // re-adds every piece's tuning (Balanced is tuneOpts[0]), so aug must restart at
    // sum+frag or Balanced is double-counted and the ceiling is over-reported. (Mirrors
    // the same reset in optimizeTuning.)
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let s = 0; s < NUM_STATS; s++) suffixUp[NUM_SLOTS][s] = 0;
    for (let i = NUM_SLOTS - 1; i >= 0; i--) {
      for (let s = 0; s < NUM_STATS; s++) {
        suffixUp[i][s] = suffixUp[i + 1][s] + chosen[i].tuneStatUpside[s];
      }
    }
    leafOk = false;
    const rec = (i: number): void => {
      if (leafOk) return;
      // Same joint-feasibility prune as optimizeTuning's directional search: if the mod
      // points needed to close every remaining deficit (even granting the best tuning
      // upside still ahead) exceed the shared budget, this branch is dead. Without it an
      // UNsatisfiable probe enumerates every tuning combination of every candidate combo
      // (exotics alone branch 31 ways), which is what made impossibility proofs slow.
      let needed = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const d = probeMins[s] - (aug[s] + suffixUp[i][s]);
        if (d > 0) {
          needed += Math.ceil(d / 5) * 5;
          if (needed > maxModPoints) return;
        }
      }
      if (i === NUM_SLOTS) {
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = Math.max(0, probeMins[s] - aug[s]);
        }
        if (assignMods(deficits, mods.major, mods.minor)) leafOk = true;
        return;
      }
      const tuned = chosen[i].tuned;
      // Exotics can put +5 into any short stat, so always branch their directionals.
      const limit =
        chosen[i].exotic || (tuned >= 0 && shortStat[tuned])
          ? chosen[i].tuneOpts.length
          : 1;
      for (let o = 0; o < limit && !leafOk; o++) {
        const opt = chosen[i].tuneOpts[o];
        for (let s = 0; s < NUM_STATS; s++) aug[s] += opt.vec[s];
        rec(i + 1);
        for (let s = 0; s < NUM_STATS; s++) aug[s] -= opt.vec[s];
      }
    };
    rec(0);
    return leafOk;
  };

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
      if (leafFeasible()) found = true;
      return;
    }
    if (!canReachMin(k)) return;
    if (!canReachSets(k)) return;
    if (needExotic && exoticCount + exoticSuffix[k] < 1) return;
    for (const p of slots[k]) {
      if (found || aborted) return;
      if (exoticMode === "none" && p.exotic) continue;
      if (exoticMode === "specific" && p.exotic && !isChosenExotic(p)) continue;
      const nextExotic = exoticCount + (p.exotic ? 1 : 0);
      if (nextExotic > 1) continue;
      for (let s = 0; s < NUM_STATS; s++) {
        sum[s] += p.stats[s];
        sumTuneUp[s] += p.tuneStatUpside[s];
      }
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]++;
      }
      chosen[k] = p;
      search(k + 1, nextExotic);
      for (let r = 0; r < reqs.length; r++) {
        if (p.setHash === reqs[r].setHash) setCounts[r]--;
      }
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
    optimistic[t] = clamp(frag[t] + suffixStat[0][t] + maxModPoints);
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
