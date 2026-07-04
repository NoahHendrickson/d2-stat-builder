import { solve, solveCeilings } from "./solve";
import type { OptimizerInput, OptimizerOutput } from "./types";

/**
 * Wall-clock budgets for the background phases after a capped search: ceilings
 * refinement first (the stat sliders' max overlays rise live), then an exhaustive
 * re-run of the build search. One worker core for up to their sum, and any input
 * change terminates the worker — still far lighter than the competitors'
 * every-core-for-the-whole-search approach.
 */
const REFINE_CEILING_BUDGET_MS = 15_000;
const REFINE_TOPN_BUDGET_MS = 30_000;
/** Share of the background progress bar covered by the ceilings phase. */
const CEILING_PROGRESS_SHARE = 0.4;

export interface SessionCallbacks {
  /** 0–1 progress. Streams for the search, then again (monotone) for the background phases. */
  onProgress: (progress: number) => void;
  /** Ceiling updates as they refine (seed first, then per-stat improvements). */
  onCeilings: (ceilings: number[]) => void;
  /**
   * A results post. `refining: true` means background work is still running and this
   * build list is frozen for this query (the UI never changes a shown list on its own)
   * — either the search was time-capped (both background phases follow) or the walk
   * completed but the ceilings are unproven (ceilings-only refinement follows). A
   * final post always follows with the SAME loadouts and the refined ceilings
   * (`refining: false`). `verified` is a claim about the POST's list: true when a
   * build walk — the in-line one or the background re-run — ran it to exhaustion.
   */
  onResult: (output: OptimizerOutput, refining: boolean, verified: boolean) => void;
  /**
   * The background build search strictly beat the frozen list. The replacement is
   * offered, never applied — the UI holds it behind a "show them" action so the list
   * only changes on user input. Posted at most once, before the final onResult.
   */
  onBetter: (output: OptimizerOutput) => void;
}

/** Budget overrides — production uses the defaults; tests shrink them to force capping. */
export interface SessionBudgets {
  topNBudgetMs?: number;
  ceilingBudgetMs?: number;
  refineCeilingBudgetMs?: number;
  refineTopNBudgetMs?: number;
}

/**
 * Did `next` rank-wise beat `prev`? Both passes walk the same deterministic order, so
 * a longer-budget pass can only match or extend a shorter one — but this is verified,
 * not assumed: a pending update is only offered when strictly better somewhere.
 * (Exported so tests assert offers against the same definition of "better".)
 */
export function beats(next: OptimizerOutput, prev: OptimizerOutput): boolean {
  if (next.loadouts.length > prev.loadouts.length) return true;
  return next.loadouts.some(
    (lo, i) => lo.total > (prev.loadouts[i]?.total ?? -1),
  );
}

/**
 * The worker's search session. The solve runs on the responsive default budgets; if it
 * completes with proven ceilings (the common case) its result is final and verified.
 * Otherwise the result is posted immediately with a FROZEN build list and background
 * work follows: (1) ceilings-only refinement — higher per-stat maxima surface live as
 * the slider overlays rise; (2) only if the walk was time-capped, an exhaustive re-run
 * of the build search — covering the blind spot where a higher-TOTAL build hides
 * inside already-proven ceilings (balanced builds move no overlay). An uncapped walk
 * whose ceilings were merely budget-starved skips phase 2 (it can't beat itself). A
 * strictly-better phase-2 list is offered via onBetter for the user to apply; the
 * final post repeats the frozen loadouts with refined ceilings.
 * Cancellation is the caller's problem (the main thread terminates the whole worker),
 * which is why this can be a plain synchronous function.
 */
export function runSolveSession(
  input: OptimizerInput,
  cb: SessionCallbacks,
  budgets: SessionBudgets = {},
): void {
  const first = solve(input, {
    onProgress: cb.onProgress,
    onCeilings: cb.onCeilings,
    topNBudgetMs: budgets.topNBudgetMs,
    ceilingBudgetMs: budgets.ceilingBudgetMs,
  });
  if (!first.capped && first.ceilingsExact) {
    cb.onResult(first, false, true);
    return;
  }
  // `verified` on the interim post is a claim about the list it carries: an uncapped
  // walk was exhaustive even though its ceilings still need background work.
  cb.onResult(first, true, !first.capped);

  // Phase 1: exact ceilings (overlays rise live; time-based progress share). When the
  // walk completed and only the ceilings were budget-starved (Noah's 81-vs-85 report:
  // constrained pools walk fast, but joint minimums make the probes expensive), this
  // is the ONLY background phase and covers the whole progress bar.
  const share = first.capped ? CEILING_PROGRESS_SHARE : 1;
  const ceilingBudgetMs = budgets.refineCeilingBudgetMs ?? REFINE_CEILING_BUDGET_MS;
  const ceilingStart = performance.now();
  const phase1 = solveCeilings(input, first.ceilings, ceilingBudgetMs, {
    // The inline pass's proven uppers seed phase 1's upper side, so it doesn't re-prove
    // the infeasibility shrinks the 1.2s inline pass already certified.
    upperSeed: first.ceilingUppers,
    onCeilings: cb.onCeilings,
    onProbe: () =>
      cb.onProgress(
        share * Math.min(1, (performance.now() - ceilingStart) / ceilingBudgetMs),
      ),
  });
  // Phase boundary: solveCeilings may run zero probes (everything already settled) and
  // emit nothing — pin the bar at the boundary so it never sits at 0% for the phase.
  cb.onProgress(share);

  if (!first.capped) {
    // The walk already ran to exhaustion — no better list can exist, so skip phase 2;
    // only the ceilings needed more time.
    cb.onResult(
      {
        ...first,
        ceilings: phase1.ceilings,
        ceilingUppers: phase1.uppers,
        ceilingsExact: phase1.exact,
      },
      false,
      true,
    );
    return;
  }

  // Phase 2: exhaustive build search. Its ceilings are instant (budget 0, seeded from
  // phase 1) and its heap is seeded with the frozen list, so the deterministic walk's
  // already-covered prefix is pruned by the admission bound instead of re-evaluated —
  // the whole budget goes to new combos.
  const second = solve(input, {
    topNBudgetMs: budgets.refineTopNBudgetMs ?? REFINE_TOPN_BUDGET_MS,
    ceilingBudgetMs: 0,
    ceilingSeed: phase1.ceilings,
    heapSeed: first.loadouts,
    onProgress: (p) =>
      cb.onProgress(CEILING_PROGRESS_SHARE + (1 - CEILING_PROGRESS_SHARE) * p),
  });
  // Both the offered list and the final post take the best proven ceilings from both
  // phases: phase 2's deeper walk can prove per-stat maxima (its top-200 seeds) that
  // phase 1's probes timed out short of. The max-merge applies to `ceilings` ONLY — the
  // proven uppers come from phase 1 (a same-input exhaustive walk's achievables can't
  // exceed a proven upper: achievable ≤ true max ≤ upper), so phase 2 can only raise the
  // achievable low side toward that upper, never past it. Ceilings are a property of the
  // QUERY, not the list, so the offer carries the same merged values.
  const ceilings = phase1.ceilings.map((v, s) => Math.max(v, second.ceilings[s]));
  const ceilingUppers = phase1.uppers;
  // Derive exactness from the ACTUAL posted pair, not phase1's flag: phase 2 can close a
  // stat phase 1 left short by proving an achievable that meets the proven upper. Honest
  // and strictly more accurate — the equality invariant on the posted pair always holds.
  const ceilingsExact = ceilings.every((v, s) => v === ceilingUppers[s]);
  if (beats(second, first)) {
    cb.onBetter({ ...second, ceilings, ceilingUppers, ceilingsExact });
  }
  cb.onResult(
    { ...first, ceilings, ceilingUppers, ceilingsExact },
    false,
    !second.capped,
  );
}
