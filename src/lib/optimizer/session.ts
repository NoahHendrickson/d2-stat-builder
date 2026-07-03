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
   * A results post. `refining: true` means the search was time-capped: this build list
   * is frozen for this query (the UI never changes a shown list on its own), and the
   * background phases are still running. A final post always follows with the SAME
   * loadouts and the refined ceilings (`refining: false`); its `verified` flag is true
   * when the background build search ran to exhaustion.
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
 */
function beats(next: OptimizerOutput, prev: OptimizerOutput): boolean {
  if (next.loadouts.length > prev.loadouts.length) return true;
  return next.loadouts.some(
    (lo, i) => lo.total > (prev.loadouts[i]?.total ?? -1),
  );
}

/**
 * The worker's search session. The solve runs on the responsive default budgets; if it
 * completes (the common case) its result is final and verified. If it was time-capped,
 * the capped result is posted immediately with a FROZEN build list, then two background
 * phases run: (1) ceilings-only refinement — higher per-stat maxima surface live as the
 * slider overlays rise; (2) an exhaustive re-run of the build search — covering the
 * blind spot where a higher-TOTAL build hides inside already-proven ceilings (balanced
 * builds move no overlay). A strictly-better phase-2 list is offered via onBetter for
 * the user to apply; the final post repeats the frozen loadouts with refined ceilings.
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
  if (!first.capped) {
    cb.onResult(first, false, true);
    return;
  }
  cb.onResult(first, true, false);

  // Phase 1: exact ceilings (overlays rise live; time-based progress share).
  const ceilingBudgetMs = budgets.refineCeilingBudgetMs ?? REFINE_CEILING_BUDGET_MS;
  const ceilingStart = performance.now();
  const ceilings = solveCeilings(
    input,
    first.ceilings,
    ceilingBudgetMs,
    cb.onCeilings,
    () =>
      cb.onProgress(
        CEILING_PROGRESS_SHARE *
          Math.min(1, (performance.now() - ceilingStart) / ceilingBudgetMs),
      ),
  );

  // Phase 2: exhaustive build search. Its ceilings are instant (budget 0, seeded from
  // phase 1) so the whole budget goes to the walk.
  const second = solve(input, {
    topNBudgetMs: budgets.refineTopNBudgetMs ?? REFINE_TOPN_BUDGET_MS,
    ceilingBudgetMs: 0,
    ceilingSeed: ceilings,
    onProgress: (p) =>
      cb.onProgress(CEILING_PROGRESS_SHARE + (1 - CEILING_PROGRESS_SHARE) * p),
  });
  if (beats(second, first)) cb.onBetter(second);
  cb.onResult({ ...first, ceilings }, false, !second.capped);
}
