import { expect, test } from "vitest";
import { runSolveSession } from "./session";
import { solve } from "./solve";
import type { OptimizerInput, OptimizerOutput, OptimizerPiece } from "./types";
import { REAL_WARLOCK_POOL } from "./real-pool.fixture";

function collector() {
  const results: { output: OptimizerOutput; refining: boolean }[] = [];
  const ceilings: number[][] = [];
  return {
    results,
    ceilings,
    cb: {
      onProgress: () => {},
      onCeilings: (c: number[]) => ceilings.push(c.slice()),
      onResult: (output: OptimizerOutput, refining: boolean) =>
        results.push({ output, refining }),
    },
  };
}

test("an uncapped search posts exactly one final result", () => {
  const piece = (id: string, stats: number[]): OptimizerPiece => ({
    id,
    stats,
    exotic: false,
  });
  const input: OptimizerInput = {
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
  const { results, cb } = collector();
  runSolveSession(input, cb);
  expect(results).toHaveLength(1);
  expect(results[0].refining).toBe(false);
  expect(results[0].output.capped).toBe(false);
});

test("a capped search freezes its build list and refines only the ceilings", () => {
  // Noah's real pool + his tight targets: ~1.4M combos, far beyond a 1ms budget, so
  // the search is guaranteed to cap at its first clock check; the background pass
  // then refines the ceilings for the same query.
  const slots = ["helmet", "arms", "chest", "legs", "classItem"].map((slot) =>
    REAL_WARLOCK_POOL.filter((p) => p.slot === slot).map((p, i) => ({
      id: `${slot}${i}`,
      stats: p.stats,
      exotic: p.exo === 1,
      setHash: p.set || undefined,
      tuning: { tuned: p.tuned, offStats: p.off },
    })),
  );
  const input: OptimizerInput = {
    slots,
    minimums: [180, 0, 0, 110, 0, 0],
    mods: { major: 3, minor: 2 },
    setRequirements: [{ setHash: 1490136267, count: 4 }],
    exotic: { mode: "any" },
    allowTuning: true,
    fragmentBonus: [0, 0, 10, -20, 0, 0],
  };
  const { results, cb } = collector();
  runSolveSession(input, cb, {
    topNBudgetMs: 1,
    ceilingBudgetMs: 50,
    refineCeilingBudgetMs: 30_000,
  });

  expect(results).toHaveLength(2);
  const [interim, final] = results;
  expect(interim.refining).toBe(true);
  expect(interim.output.capped).toBe(true);
  expect(final.refining).toBe(false);

  // The build list is FROZEN: the final post repeats the capped list verbatim (and
  // stays flagged capped — it is still a best-effort list for these targets).
  expect(final.output.loadouts).toEqual(interim.output.loadouts);
  expect(final.output.capped).toBe(true);

  // Ceilings only ever rise across the refinement…
  for (let s = 0; s < 6; s++) {
    expect(final.output.ceilings[s]).toBeGreaterThanOrEqual(
      interim.output.ceilings[s],
    );
  }
  // …and land on the same exact values a full uncapped solve computes.
  const reference = solve(input, { topNBudgetMs: 60_000, ceilingBudgetMs: 30_000 });
  expect(reference.capped).toBe(false);
  expect(final.output.ceilings).toEqual(reference.ceilings);
}, 180_000);
