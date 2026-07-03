import { solve, solveCeilings } from "./solve";
import type { OptimizerInput, OptimizerOutput } from "./types";

/**
 * Wall-clock budget for the background ceilings refinement after a capped search.
 * One worker core for up to this long, and any input change terminates the worker —
 * still far lighter than the competitors' every-core-for-the-whole-search approach.
 */
const REFINE_CEILING_BUDGET_MS = 30_000;

export interface SessionCallbacks {
  /** 0–1 progress. Streams for the search, then again for the background refinement. */
  onProgress: (progress: number) => void;
  /** Ceiling updates as they refine (seed first, then per-stat improvements). */
  onCeilings: (ceilings: number[]) => void;
  /**
   * A results post. `refining: true` means the search was time-capped: this build list
   * is final for this query (the UI freezes it — a list must never change under the
   * reader), but the stat ceilings are still being refined in the background. A second
   * post always follows with the SAME loadouts and the refined ceilings
   * (`refining: false`).
   */
  onResult: (output: OptimizerOutput, refining: boolean) => void;
}

/** Budget overrides — production uses the defaults; tests shrink them to force capping. */
export interface SessionBudgets {
  topNBudgetMs?: number;
  ceilingBudgetMs?: number;
  refineCeilingBudgetMs?: number;
}

/**
 * The worker's search session. The solve runs on the responsive default budgets; if it
 * completes (the common case) its result is final. If it was time-capped, the capped
 * result is posted immediately — and its build list is FINAL by design; better builds
 * the window missed are deliberately not chased, so the list never changes under the
 * reader — while a much longer ceilings-only pass keeps refining the per-stat maxima.
 * Higher maxima surface as the stat sliders' overlays rising; acting on them (dragging
 * a target up) starts a fresh search. The final post repeats the same loadouts with the
 * refined ceilings. Cancellation is the caller's problem (the main thread terminates
 * the whole worker), which is why this can be a plain synchronous function.
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
  cb.onResult(first, first.capped);
  if (!first.capped) return;

  const budgetMs = budgets.refineCeilingBudgetMs ?? REFINE_CEILING_BUDGET_MS;
  const start = performance.now();
  const ceilings = solveCeilings(input, first.ceilings, budgetMs, cb.onCeilings, () =>
    cb.onProgress(Math.min(1, (performance.now() - start) / budgetMs)),
  );
  cb.onResult({ ...first, ceilings }, false);
}
