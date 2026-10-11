/**
 * Independent minimal repros of two known findings that prune-admissibility.test.ts's
 * end-to-end check rediscovered: F1 (raiseAchievableFloors dumped spare mods onto a stat
 * clamped up from below 0; fixed in 153701d) and F3 (dedupe keyed every exotic's tuning
 * as "X", merging a Balanced-only exotic with a directional-capable twin; fixed in
 * 0221eea). Both fixes are cherry-picked onto this branch, so these run green as
 * regression tests. Before the fixes, every test here failed.
 */
import { describe, expect, test } from "vitest";
import { solve } from "../solve";
import { solveCeilings } from "../ceilings";
import { buildSlots } from "../bounds";
import type { OptimizerInput, OptimizerPiece } from "../types";

const GENEROUS = { topNBudgetMs: 20_000, ceilingBudgetMs: 20_000 };
const piece = (id: string, stats: number[], extra: Partial<OptimizerPiece> = {}): OptimizerPiece => ({
  id,
  stats,
  exotic: false,
  ...extra,
});
const Z = [0, 0, 0, 0, 0, 0];

describe("F1 — achievable-floor dump onto a stat clamped at 0", () => {
  /**
   * Weapons pre-clamp is 10 − 30 = −20, clamped to 0. One unused major (+10) only lifts
   * it to −10 → still 0, so the true weapons ceiling is 0. Pre-fix: the top-N seed was
   * clamp(0 + 10) = 10 > the proven upper clamp(−30 + 10 + 10) = 0, and
   * reconcileCeilingBounds threw ("achievable 10 > proven upper 0").
   */
  test("top-N seed path: solve() reports weapons ceiling 0", () => {
    const input: OptimizerInput = {
      slots: [[piece("a", [10, 0, 0, 0, 0, 0])], [piece("b", Z)], [piece("c", Z)], [piece("d", Z)], [piece("e", Z)]],
      minimums: [0, 0, 0, 0, 0, 0],
      mods: { major: 1, minor: 0 },
      fragmentBonus: [-30, 0, 0, 0, 0, 0],
      allowTuning: false,
    };
    const out = solve(input, GENEROUS);
    expect(out.ceilings[0]).toBe(0);
    expect(out.ceilingsExact).toBe(true);
  });

  /**
   * Probe witness-harvest path, with the proven upper ABOVE the bad floor: pre-fix this
   * returned ceilings[0] = 10 with exact = true (silent certified over-report). Health ≥ 15
   * forces "h", so weapons pre-clamp is 20 − 30 = −10 and one spare major reaches 0.
   */
  test("witness harvest path: weapons ceiling 0, exact", () => {
    const inp: OptimizerInput = {
      slots: [
        [piece("w", [40, 0, 0, 0, 0, 0]), piece("h", [0, 25, 0, 0, 0, 0])],
        [piece("b", [20, 0, 0, 0, 0, 0])],
        [piece("c", Z)],
        [piece("d", Z)],
        [piece("e", Z)],
      ],
      minimums: [0, 15, 0, 0, 0, 0],
      mods: { major: 1, minor: 0 },
      fragmentBonus: [-30, 0, 0, 0, 0, 0],
      allowTuning: false,
    };
    const out = solveCeilings(inp, [0, 0, 0, 0, 0, 0], 20_000);
    expect(out.ceilings[0]).toBe(0);
  });
});

describe("F3 — dedupe must not merge a Balanced-only exotic with a directional-capable twin", () => {
  const ex = (id: string, directional: boolean): OptimizerPiece => ({
    id,
    stats: [10, 10, 10, 10, 10, 10],
    exotic: true,
    hash: 901,
    tuning: { tuned: 0, offStats: [3, 4, 5], ...(directional ? {} : { directional: false as const }) },
  });
  const input: OptimizerInput = {
    slots: [[ex("balancedOnly", false), ex("flex", true)], [piece("b", Z)], [piece("c", Z)], [piece("d", Z)], [piece("e", Z)]],
    minimums: [15, 0, 0, 0, 0, 0],
    mods: { major: 0, minor: 0 },
    exotic: { mode: "any" },
  };
  test("both exotics survive buildSlots", () => {
    expect(buildSlots(input)[0].map((p) => p.id).sort()).toEqual(["balancedOnly", "flex"]);
  });
  test("solve() finds the build that needs the flexible exotic's +5 weapons", () => {
    const out = solve(input, GENEROUS);
    expect(out.loadouts.length).toBeGreaterThan(0);
    expect(out.loadouts[0].pieceIds[0]).toBe("flex");
  });
});
