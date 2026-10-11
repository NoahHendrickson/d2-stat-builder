/**
 * Deterministic minimal repros for what the metamorphic discovery suite found. Each
 * `test.fails` asserts the relation that SHOULD hold (per the brief) and currently doesn't;
 * flipping one to `test` is the regression check once the behaviour is decided/fixed.
 * Plain `test`s pin current behaviour the relations depend on.
 */
import { describe, expect, test } from "vitest";
import { solve } from "../solve";
import { assignMods, createTuningSearcher, makeInternalPiece } from "../tuning";
import type { OptimizerInput, OptimizerPiece } from "../types";

const GENEROUS = { topNBudgetMs: 30_000, ceilingBudgetMs: 30_000 };
const ZERO = [0, 0, 0, 0, 0, 0];

// ---------------------------------------------------------------------------
// FINDING T1 — maximize total depends on piece (slot) order when a −5 hits the 0-clamp
// ---------------------------------------------------------------------------

/**
 * Melee sits at −11 pre-clamp (fragment −30), Super is 1 short of 70, no mods, Balanced off.
 *  - Order [p0, p1, …]: p0's +5 Super bridges it; at p1 Class (19 + p4's possible −5 = 14)
 *    "can't be short", so p1's +Class directional is never branched → best 280.
 *  - Order [p1, p0, …]: at the root Class COULD be short (p0 and p4 might each −5 it), so
 *    p1's +5 Class / −5 Super is branched; Super is then short again, which admits BOTH
 *    p0's and p4's +5 Super / −5 Melee — the −5s vanish into Melee's 0-clamp → 285.
 * The 285 build is legal, but it holds a directional that bridges nothing (Class 24 vs
 * min 14) — so either the tuner's answer should be 285 regardless of order (maximize
 * over all directional combos) or 280 regardless of order (directionals only where
 * needed). Root cause: the per-node "could still be short" test (tuning.ts:670) reads
 * the options already applied to EARLIER pieces, and the dominance argument in the
 * factory doc (tuning.ts:364-377) covers feasibility only — swapping a directional for
 * the default does not preserve the TOTAL when its −5 is absorbed by clamp(·) at 0.
 */
const T1: OptimizerPiece[] = [
  { id: "p0", stats: [20, 25, 5, 30, 5, 5], exotic: false, tuning: { tuned: 4, offStats: [2, 4, 5] } },
  { id: "p1", stats: [5, 20, 5, 25, 30, 5], exotic: false, tuning: { tuned: 2, offStats: [0, 2, 5] } },
  { id: "p2", stats: [2, 2, 2, 2, 2, 2], exotic: false },
  { id: "p3", stats: [2, 2, 2, 2, 2, 2], exotic: false },
  { id: "p4", stats: [20, 5, 5, 25, 30, 5], exotic: true, hash: 1000, tuning: { tuned: 1, offStats: [1, 2, 5] } },
];
const T1_FRAG = [0, 0, 0, 0, 0, -30];
const T1_MINS = [0, 0, 14, 0, 70, 0];

function tuneOrder(order: number[]) {
  const chosen = order.map((i) => makeInternalPiece(T1[i], true, false, T1_MINS));
  const sum = [...ZERO];
  for (const p of chosen) for (let s = 0; s < 6; s++) sum[s] += p.stats[s];
  return createTuningSearcher(T1_FRAG, { major: 0, minor: 0 })(chosen, sum, T1_MINS, "maximize");
}

describe("FINDING T1: leaf maximize depends on piece order (0-clamp absorbs a −5)", () => {
  test("current behaviour: 280 in slot order, 285 with the first two pieces swapped", () => {
    expect(tuneOrder([0, 1, 2, 3, 4])!.total).toBe(280);
    expect(tuneOrder([1, 0, 2, 3, 4])!.total).toBe(285);
  });

  test.fails("leaf: maximize total is invariant under piece order", () => {
    expect(tuneOrder([1, 0, 2, 3, 4])!.total).toBe(tuneOrder([0, 1, 2, 3, 4])!.total);
  });

  test.fails("solve: swapping two slots changes the (only) build's total", () => {
    const input = (order: number[]): OptimizerInput => ({
      slots: order.map((i) => [T1[i]]),
      minimums: T1_MINS,
      fragmentBonus: T1_FRAG,
      mods: { major: 0, minor: 0 },
      allowBalancedTuning: false,
    });
    const a = solve(input([0, 1, 2, 3, 4]), GENEROUS);
    const b = solve(input([1, 0, 2, 3, 4]), GENEROUS);
    expect(a.loadouts).toHaveLength(1);
    expect(b.loadouts.map((l) => l.total)).toEqual(a.loadouts.map((l) => l.total));
  });
});

// ---------------------------------------------------------------------------
// QUESTION Q2 — the ranking total depends on stat ORDER through assignMods
// ---------------------------------------------------------------------------

/**
 * Deficits {1, 1, 6} with 2 majors + 2 minors: assignMods covers stats in index order,
 * majors first, so [1,1,6] → major, major, 2 minors = 30 points, but [6,1,1] → major,
 * major, minor = 25 points. Mods' overshoot is counted in the maximize total, so the
 * SAME build scores 5 differently depending on which stat indices carry the deficits
 * (tuning.ts:261-277 / 291-321 first-found covering). Not a legality bug (both coverings
 * are legal); a ranking-policy question: should maximize pick the covering with the most
 * (clamped) points, or should the total exclude overshoot?
 */
describe("QUESTION Q2: mod covering (and so the total) depends on stat order", () => {
  test("assignMods: same deficit multiset, different points", () => {
    const pts = (d: number[]) => assignMods(d, 2, 2)!.points.reduce((a, b) => a + b, 0);
    expect(pts([1, 1, 6, 0, 0, 0])).toBe(30);
    expect(pts([6, 1, 1, 0, 0, 0])).toBe(25);
  });

  test.fails("leaf: relabeling stats keeps the maximize total", () => {
    // Untuned pool; weapons/health/class need 1/1/6 (mins 61/51/91 vs 60/50/85).
    const pieces: number[][] = [
      [5, 5, 25, 30, 5, 20],
      [20, 5, 5, 25, 30, 5],
      [25, 5, 20, 5, 30, 5],
      [5, 30, 5, 20, 5, 25],
      [5, 5, 30, 25, 20, 5],
    ];
    const mins = [61, 51, 91, 0, 0, 0];
    const total = (perm: number[]) => {
      const p6 = (v: number[]) => {
        const o = [...ZERO];
        v.forEach((x, s) => (o[perm[s]] = x));
        return o;
      };
      const chosen = pieces.map((s, i) => makeInternalPiece({ id: `p${i}`, stats: p6(s), exotic: false }, false, false));
      const sum = [...ZERO];
      for (const p of chosen) for (let s = 0; s < 6; s++) sum[s] += p.stats[s];
      return createTuningSearcher(ZERO, { major: 2, minor: 2 })(chosen, sum, p6(mins), "maximize")!.total;
    };
    expect(total([0, 1, 2, 3, 4, 5])).toBe(480);
    expect(total([3, 4, 1, 0, 2, 5])).toBe(480); // actually 475
  });
});

// ---------------------------------------------------------------------------
// FINDING D1 (latent) — dedupe merges an exotic Balanced-only roll with a directional one
// ---------------------------------------------------------------------------

/**
 * bounds.ts:46-49: the tuneKey for an exotic is "X" + offStats — it ignores
 * `tuning.directional === false`, so two same-hash, same-stat exotics, one with the
 * flexible directional slot and one Balanced-only, collapse to whichever comes FIRST.
 * Feasibility then depends on the order of pieces inside a slot ("merging must never
 * change feasibility"). Latent: dream.ts:279-281 never builds a Balanced-only exotic.
 */
describe("FINDING D1 (latent): exotic dedupe key ignores directional:false", () => {
  const base = (exotic: OptimizerPiece[]): OptimizerInput => ({
    slots: [
      exotic,
      [{ id: "a", stats: [30, 25, 20, 5, 5, 5], exotic: false }],
      [{ id: "c", stats: [30, 25, 20, 5, 5, 5], exotic: false }],
      [{ id: "l", stats: [30, 25, 20, 5, 5, 5], exotic: false }],
      [{ id: "ci", stats: [30, 25, 20, 5, 5, 5], exotic: false }],
    ],
    // Melee 25 needs the exotic's +5 melee directional (no mods).
    minimums: [0, 0, 0, 0, 0, 30],
    mods: { major: 0, minor: 0 },
  });
  const flex: OptimizerPiece = {
    id: "flex",
    stats: [30, 25, 20, 5, 5, 5],
    exotic: true,
    hash: 9,
    tuning: { tuned: 0, offStats: [3, 4, 5] },
  };
  const balOnly: OptimizerPiece = { ...flex, id: "bal", tuning: { ...flex.tuning!, directional: false } };

  test("directional exotic first: feasible", () => {
    expect(solve(base([flex, balOnly]), GENEROUS).loadouts.length).toBeGreaterThan(0);
  });
  test.fails("Balanced-only exotic first: should still be feasible (the merge drops the flexible one)", () => {
    expect(solve(base([balOnly, flex]), GENEROUS).loadouts.length).toBeGreaterThan(0);
  });
});
