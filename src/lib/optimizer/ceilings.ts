import type { ModBudget, OptimizerInput, SetRequirement } from "./types";
import { NUM_SLOTS, NUM_STATS, STAT_CAP, clamp, raiseAchievableFloors } from "./floors";
import {
  createTuningSearcher,
  type InternalPiece,
  type TuningOutcome,
} from "./tuning";
import { buildSlots, computeSuffixBounds, makeJointMinCheck } from "./bounds";
import { createPowerTracker } from "./power";

/**
 * Wall-clock budget for refining the per-stat ceilings past their seed values. Exact
 * ceilings are cheap on small/loosely-constrained gear (finishes well under this) but can
 * be very expensive on large, tightly-constrained pools — there the refinement stops at
 * the budget and reports the best guaranteed-achievable value found so far.
 */
export const CEILING_BUDGET_MS = 1200;

/** Options for {@link solveCeilings} — an object since later steps grow this list. */
export interface SolveCeilingsOptions {
  /** Ceiling updates as they refine (seed first, then per-stat improvements). */
  onCeilings?: (ceilings: number[]) => void;
  /** Fired on every probe completion (and periodically during long probes). */
  onProbe?: () => void;
  /**
   * Per-stat PROVEN upper bounds from a prior pass over this EXACT input — MUST be genuine
   * proven bounds (same trust contract as `seed`, which must be proven-achievable): a value
   * too low would clamp a real ceiling shut. Each stat's binary search starts with its upper
   * side narrowed to this seed (often already closed against the seed), so a background pass
   * doesn't re-prove what an earlier pass established.
   */
  upperSeed?: number[];
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
): { ceilings: number[]; uppers: number[]; exact: boolean; stats: CeilingStats } {
  const slots = buildSlots(input);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) {
    // Degenerate pool (empty slot / wrong slot count): the seed values are the only
    // achievable lows we can trust, but NOTHING has been proven about the true maxima here,
    // so the honest upper bound is the trivial-but-always-proven STAT_CAP per stat. That
    // keeps ceilings ≤ uppers with strict inequality where seed < cap, so `exact: false` is
    // self-consistent with the documented equality ⇔ exact invariant (returning uppers = seed
    // would falsely imply the seed had been proven as the maximum).
    return {
      ceilings: seed.slice(0, NUM_STATS),
      uppers: new Array(NUM_STATS).fill(STAT_CAP),
      exact: false,
      stats: EMPTY_CEILING_STATS,
    };
  }
  return runCeilings(input, slots, seed, budgetMs, {
    upperSeed: opts.upperSeed,
    onCeilings: opts.onCeilings,
    onProbe: opts.onProbe,
  });
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
 * the shared budget (see the scheduling comment below).
 *
 * `uppers` is the PROVEN upper side, tracked separately from the working `optimistic`
 * window: it starts at the suffix bound (itself proven) and shrinks ONLY when a probe
 * runs to completion infeasible (a certified `mid−1` upper), never on a timeout. `exact`
 * is derived from `ceilings[t] === uppers[t]` for every stat — strictly more accurate
 * than incrementally clearing a flag, since a stat whose window closes provenly (or is
 * settled by `upperSeed` with zero probes) is exact even if an unrelated probe timed out.
 * When inexact the ceilings are guaranteed-achievable lower bounds. An infeasible query
 * (no build meets the minimums) yields zeros.
 */
export function runCeilings(
  input: OptimizerInput,
  slots: InternalPiece[][],
  seed: number[],
  budgetMs: number,
  opts: {
    upperSeed?: number[];
    onCeilings?: (ceilings: number[]) => void;
    onProbe?: () => void;
  } = {},
): { ceilings: number[]; uppers: number[]; exact: boolean; stats: CeilingStats } {
  const onProgress = opts.onCeilings;
  const onProbe = opts.onProbe;
  const upperSeed = opts.upperSeed;
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

  // Armor power range — the same tracker the top-N walk uses (null when none is set).
  const power = createPowerTracker(slots, input.powerRange);

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
  // The one deadline check, shared by the walk (every 2048 nodes) and the leaf tuner's
  // directional search (its `onTick`): a probe whose budget expires inside a long leaf
  // is flagged `aborted` and counts as timed out — never as a disproof.
  const tick = (): void => {
    const now = performance.now();
    if (now > probeDeadline) {
      aborted = true;
      return;
    }
    if (onProbe && now - lastTickAt >= TICK_INTERVAL_MS) {
      lastTickAt = now;
      onProbe();
    }
  };
  // Per-leaf tuning feasibility probe — the same search the top-N uses, in feasible
  // (first-hit) mode, so the two can never drift apart again.
  const tuner = createTuningSearcher(frag, mods, tick);
  const search = (k: number, exoticCount: number): void => {
    if (aborted) return;
    if ((nodes++ & 2047) === 0) {
      tick();
      if (aborted) return;
    }
    if (k === NUM_SLOTS) {
      if (needExotic && exoticCount !== 1) return;
      for (let r = 0; r < reqs.length; r++) {
        if (setCounts[r] < reqs[r].count) return;
      }
      if (power && !power.feasible(NUM_SLOTS)) return;
      // A witness found after the deadline tripped mid-leaf is still a witness (a found
      // build is proof); a null after it is a timeout, not a disproof (`aborted` is set).
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
    if (power && !power.feasible(k)) return;
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
      power?.push(p);
      chosen[k] = p;
      search(k + 1, nextExotic);
      power?.pop(p);
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
  // `uppers[t]` is the PROVEN high side (suffix bound, then shrunk only by completed
  // infeasible probes); `optimistic[t]` is the working binary-search window (also shrunk
  // by timeouts). They start equal; a timeout pulls `optimistic` below `uppers`.
  const uppers = new Array(NUM_STATS).fill(0);
  const optimistic = new Array(NUM_STATS).fill(0);
  let pending: number[] = [];
  const stats: CeilingStats = { probes: 0, feasible: 0, disproven: 0, timedOut: 0, nodes: 0 };
  for (let t = 0; t < NUM_STATS; t++) {
    const init = clamp(frag[t] + suffixStat[0][t] + maxModPoints + artSuffix[0] * 3);
    // With a proven upperSeed, narrow the proven high side to it — but never below the
    // seed's own achievable ceiling (defends against a too-low seed clamping a real
    // ceiling shut; the min(init, …) keeps a bogus-high seed from loosening the bound).
    uppers[t] =
      upperSeed !== undefined
        ? Math.max(ceiling[t], Math.min(init, upperSeed[t]))
        : init;
    optimistic[t] = uppers[t];
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
          // Unproven shrink: narrow only the working window, never the proven upper.
          optimistic[t] = mid - 1;
        } else {
          stats.disproven++;
          // Proven infeasible: `mid−1` is a certified upper — shrink BOTH sides.
          uppers[t] = Math.min(uppers[t], mid - 1);
          optimistic[t] = mid - 1;
        }
      }
      if (ceiling[t] < optimistic[t]) next.push(t);
    }
    if (performance.now() >= globalDeadline) break; // budget spent — keep proven values
    pending = next;
  }
  // Exactness is the equality of the proven pair: a stat is exact iff its achievable
  // ceiling has met its proven upper. Any gap (a timed-out or budget-starved window that
  // never closed provenly) makes the whole result inexact.
  let exact = !reconcileCeilingBounds(ceiling, uppers);
  for (let t = 0; t < NUM_STATS; t++) {
    if (ceiling[t] < uppers[t]) exact = false;
  }
  stats.nodes = nodes;
  return { ceilings: ceiling, uppers, exact, stats };
}

/**
 * `ceilings[t] <= uppers[t]` is an invariant, not a clamp: the low side only rises on a
 * witnessed build (arithmetic proof) and the upper only falls on a probe that ran to
 * completion infeasible. If they ever cross, one of the two "proofs" was wrong — the
 * 2026-09-21 review saw exactly that when an incomplete leaf tuner disproved feasible
 * probes while another stat's witness harvest raised the same stat's floor past them,
 * and the old `exact` check (only `ceiling < upper` ⇒ inexact) reported the reversed
 * pair as EXACT. So: outside production this throws (tests and dev must see the bug);
 * in production it logs, keeps the witnessed value (a real build beats a suspect
 * disproof), lifts the upper to meet it and returns true so the caller marks the result
 * inexact — never exact, never silently consistent.
 */
function reconcileCeilingBounds(ceilings: number[], uppers: number[]): boolean {
  let contradiction = false;
  for (let t = 0; t < NUM_STATS; t++) {
    if (ceilings[t] <= uppers[t]) continue;
    const msg = `ceiling invariant violated: stat ${t} achievable ${ceilings[t]} > proven upper ${uppers[t]}`;
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      throw new Error(msg);
    }
    console.error(msg);
    uppers[t] = ceilings[t];
    contradiction = true;
  }
  return contradiction;
}
