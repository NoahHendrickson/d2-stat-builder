/**
 * Deterministic repros for the carryover/session discovery pass (see the worker report).
 * Each is marked `test.fails` so the discovery suite stays green while the behaviour stands;
 * a fix flips it to a failure here (then drop the `.fails`).
 */
import { expect, test, vi } from "vitest";
import { solve } from "../solve";
import type { OptimizerInput, OptimizerPiece } from "../types";

const piece = (id: string, stats: number[]): OptimizerPiece => ({ id, stats, exotic: false });
const tiny: OptimizerInput = {
  slots: [
    [piece("h", [30, 0, 0, 0, 0, 0])],
    [piece("a", [0, 20, 0, 0, 0, 0])],
    [piece("c", [0, 0, 10, 0, 0, 0])],
    [piece("l", [0, 0, 0, 40, 0, 0])],
    [piece("k", [0, 0, 0, 0, 15, 0])],
  ],
  minimums: [0, 0, 0, 0, 0, 0],
  allowTuning: false,
};

// N1 (minor, test-config only): solve.ts emitTopNProgress computes
// timeFrac = (now - topNStart) / topNBudgetMs; with topNBudgetMs = 0 and a clock that
// has not advanced (coarse timers can return the same value twice) that is 0/0 = NaN,
// and Math.max/Math.min propagate it, so onProgress receives NaN. Production never
// passes a 0 top-N budget (worker.ts passes no overrides; phase 2 uses 30 s), so this
// is only reachable from tests / future callers. Expected: progress stays in [0, 1].
test.fails("N1: a zero top-N budget on a non-advancing clock streams NaN progress", () => {
  const spy = vi.spyOn(performance, "now").mockReturnValue(1000);
  const progress: number[] = [];
  try {
    solve(tiny, { topNBudgetMs: 0, ceilingBudgetMs: 0, onProgress: (p) => progress.push(p) });
  } finally {
    spy.mockRestore();
  }
  for (const p of progress) expect(Number.isFinite(p)).toBe(true);
});

// N2 (boundary, QUESTION): maxResults 0 builds a TopNHeap of capacity 0; the first valid
// leaf passes couldInsert (worst = -Infinity) and insert() dereferences heap[0] of an
// empty heap → TypeError. No current caller sends 0 (UI sends 200, weapon-plan 1,
// dream.ts `variants.length` which includes the piece itself), so this is a latent edge.
test.fails("N2: maxResults 0 throws instead of returning an empty list", () => {
  expect(() => solve({ ...tiny, maxResults: 0 }, { topNBudgetMs: 1e9, ceilingBudgetMs: 1e9 })).not.toThrow();
});
