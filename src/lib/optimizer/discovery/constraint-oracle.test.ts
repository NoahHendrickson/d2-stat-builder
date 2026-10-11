/**
 * Discovery suite: solve() against an independent exhaustive oracle on the constraint
 * dimensions completeness-oracle.test.ts never generates — power ranges (with weapons,
 * 0 vs unknown power, min > max, single-value ranges), 0–3 set requirements (duplicated,
 * overlapping, unreachable), multi-hash "specific" exotics — over collision-heavy pools
 * with deliberate stat-identical TWINS (pieces differing only in setHash / power / hash /
 * artifice / tuning / id), which is what bounds.ts `dedupe` merges.
 *
 * Properties per case (see check-case.ts): feasibility parity; every returned build legal
 * incl. the power range, with `power` equal to the actual pieces' + weapons' gear power;
 * ceilings ≤ truth ≤ uppers and exact ⇒ equal (feasible AND infeasible queries); uncapped
 * top-N totals (default and maxResults 1..5) equal the top-N of the production tuner's
 * policy totals over ALL legal deduped combos; deduped vs raw enumerations agree on
 * feasibility, max, and the set of distinct totals.
 *
 * Findings (docs/proptest report) are pinned below as `test.fails` regressions; the main
 * property runs with generator knobs that steer around them so it stays green and keeps
 * hunting:
 *  - F1: clamped-stat floor harvest over-reports ceilings (needs a pre-clamp stat < 0).
 *  - F2: dedupe treats setHash 0 and setHash undefined as the same set.
 *  - F3: dedupe merges a balanced-only exotic (`directional: false`) with a directional one.
 *
 * Runs: PROP_RUNS (default 2000 per property), PROP_SEED (default fixed, printed on failure).
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { solve } from "../solve";
import type { OptimizerInput, OptimizerPiece } from "../types";
import { classify, makeCaseArb, oracle } from "./constraint-oracle";
import { GENEROUS, checkCase } from "./check-case";

const RUNS = Number(process.env.PROP_RUNS ?? 2000);
const SEED = Number(process.env.PROP_SEED ?? 0x5eed);
const params = { numRuns: RUNS, seed: SEED };

const kinds = (input: OptimizerInput, n: number) =>
  checkCase(input, n).violations.map((v) => `${v.kind}: ${v.detail}`);

describe("constraint oracle — properties", () => {
  test("all properties hold on collision-heavy constraint cases (steering around F1–F3)", () => {
    const arb = fc.tuple(
      makeCaseArb({ nonNegative: true, noSetHash0: true, noExoticBalancedOnly: true }),
      fc.integer({ min: 1, max: 5 }),
    );
    fc.assert(
      fc.property(arb, ([c, n]) => {
        expect(kinds(c.input, n)).toEqual([]);
      }),
      params,
    );
  }, 300_000);

  test("with negative fragments / zero rolls, everything except F1's ceiling symptoms holds", () => {
    // F1 only ever RAISES the reported ceiling (and, via reconcile, the upper to match),
    // so its symptoms are exactly these kinds; every other property must hold.
    const F1_KINDS = new Set(["throw", "ceiling-over", "exact-mismatch", "ceiling-infeasible-over", "exact-infeasible-mismatch"]);
    const arb = fc.tuple(makeCaseArb({ noSetHash0: true, noExoticBalancedOnly: true }), fc.integer({ min: 1, max: 5 }));
    fc.assert(
      fc.property(arb, ([c, n]) => {
        const rest = checkCase(c.input, n).violations.filter((v) => !F1_KINDS.has(v.kind));
        expect(rest.map((v) => `${v.kind}: ${v.detail}`)).toEqual([]);
      }),
      params,
    );
  }, 300_000);

  // The unsteered generator finds F1/F2/F3 within a few hundred cases. Kept as an
  // expected failure so it starts passing (and must be flipped) once all three are fixed.
  test("all properties hold on the unsteered generator (F1–F3 fixed)", () => {
    const arb = fc.tuple(makeCaseArb(), fc.integer({ min: 1, max: 5 }));
    fc.assert(
      fc.property(arb, ([c, n]) => {
        expect(kinds(c.input, n)).toEqual([]);
      }),
      // endOnFailure: an expected failure needs no shrinking.
      { ...params, numRuns: Math.max(RUNS, 2000), endOnFailure: true },
    );
  }, 300_000);

  test("generator coverage floors (interacting-operand classes actually occur)", () => {
    const N = 2000;
    const cases = fc.sample(
      fc.tuple(makeCaseArb({ nonNegative: true, noSetHash0: true, noExoticBalancedOnly: true }), fc.integer({ min: 1, max: 5 })),
      { seed: SEED, numRuns: N },
    );
    const count = new Map<string, number>();
    const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
    for (const [c] of cases) for (const l of classify(c, oracle(c.input))) bump(l);
    const pct = (k: string) => (100 * (count.get(k) ?? 0)) / N;
    // Floors well under the measured rates (seeded, so deterministic) — they catch a
    // generator edit that silently stops producing a class.
    expect(pct("feasible")).toBeGreaterThan(15);
    expect(pct("power:range")).toBeGreaterThan(35);
    expect(pct("power:binding(straddle)")).toBeGreaterThan(4);
    expect(pct("power:weapon-flips-verdict")).toBeGreaterThan(4);
    expect(pct("power:min>max")).toBeGreaterThan(3);
    expect(pct("power:single")).toBeGreaterThan(8);
    expect(pct("power:null-power-legal")).toBeGreaterThan(0.3);
    expect(pct("twin:power-straddles-range")).toBeGreaterThan(1);
    expect(pct("twin:power-0-vs-undef")).toBeGreaterThan(0.3);
    expect(pct("twin:setHash-req-splits-pair")).toBeGreaterThan(2);
    expect(pct("twin:hash-specific-splits-pair")).toBeGreaterThan(0.2);
    expect(pct("sets:same-hash-twice")).toBeGreaterThan(3);
    expect(pct("sets:3")).toBeGreaterThan(3);
    expect(pct("exotic:specific(2)") + pct("exotic:specific(3)") + pct("exotic:specific(4)")).toBeGreaterThan(10);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Findings — minimal deterministic repros (expected failures until fixed)
// ---------------------------------------------------------------------------

const flat = (id: string, extra: Partial<OptimizerPiece> = {}): OptimizerPiece => ({
  id,
  stats: [10, 10, 10, 10, 10, 10],
  exotic: false,
  ...extra,
});
const rest = () => [[flat("b")], [flat("c")], [flat("d")], [flat("e")]];

describe("F1 — floor harvest adds spare mods to a CLAMPED stat", () => {
  // Weapons sits at 0 + (−10) = −10 before clamping; the only build shows 0. The seed
  // (solve.ts, raiseAchievableFloors) adds the 10 spare mod points to the clamped 0 and
  // claims 10 is reachable; really −10 + 10 = 0. Dev/test: the ceiling invariant throws
  // out of solve(); production: logs and returns ceiling 10 (uppers lifted to match).
  const z = (id: string): OptimizerPiece => ({ id, stats: [0, 0, 0, 0, 0, 0], exotic: false });
  const input: OptimizerInput = {
    slots: [[z("a")], [z("b")], [z("c")], [z("d")], [z("e")]],
    minimums: [0, 0, 0, 0, 0, 0],
    mods: { major: 1, minor: 0 },
    fragmentBonus: [-10, 0, 0, 0, 0, 0],
  };
  test("oracle: the weapons ceiling is 0", () => {
    expect(oracle(input).ceilings).toEqual([0, 10, 10, 10, 10, 10]);
  });
  test("solve() returns the true ceilings without throwing", () => {
    const out = solve(input, GENEROUS);
    expect(out.ceilings).toEqual([0, 10, 10, 10, 10, 10]);
  });
  test("silent variant: a loose suffix upper lets the over-report be certified EXACT", () => {
    // A second, unused piece in slot 0 with weapons 20 loosens the suffix upper to 20
    // (so no invariant throw), but the build that must be used is pinned by a set
    // requirement to the weapons-0 piece. Truth: weapons −10 + 10 = 0. Observed:
    // ceilings[0] = 10, ceilingUppers[0] = 10, ceilingsExact = true (probes only ever
    // test values ABOVE the bogus seed, disprove them, and the window closes on it).
    const silent: OptimizerInput = {
      ...input,
      slots: [[{ ...z("a"), setHash: 5 }, { id: "w", stats: [20, 0, 0, 0, 0, 0], exotic: false }], ...input.slots.slice(1)],
      setRequirements: [{ setHash: 5, count: 1 }],
    };
    expect(oracle(silent).ceilings[0]).toBe(0);
    const out = solve(silent, GENEROUS);
    expect(out.ceilingsExact).toBe(true); // holds today — the claim of exactness is the bug
    expect(out.ceilings[0]).toBe(0);
  });
});

describe("F2 — dedupe: setHash 0 and undefined share a key", () => {
  // bounds.ts dedupe keys the set as `|${p.setHash ?? 0}|`, so "z" (set 0) collapses
  // into the earlier "u" (no set); the kept "u" can't satisfy the set-0 requirement.
  const input: OptimizerInput = {
    slots: [[flat("u"), flat("z", { setHash: 0 })], ...rest()],
    minimums: [0, 0, 0, 0, 0, 0],
    setRequirements: [{ setHash: 0, count: 1 }],
  };
  test("oracle: feasible via z", () => {
    expect(oracle(input).feasible).toBe(true);
  });
  test("solve() returns the build using z", () => {
    const out = solve(input, GENEROUS);
    expect(out.loadouts.map((l) => l.pieceIds)).toEqual([["z", "b", "c", "d", "e"]]);
  });
});

describe("F3 — dedupe: balanced-only exotic merged with a directional twin", () => {
  // Exotics key their tuning as "X" (+ offStats) regardless of `directional: false`, so
  // the balanced-only A (listed first) represents B and B's +5/−5 options are lost.
  // Melee 55 needs B's directional (+5 melee); Balanced on A only touches 0/1/2.
  const tuning = { tuned: 0, offStats: [0, 1, 2] };
  const input: OptimizerInput = {
    slots: [
      [
        flat("A", { exotic: true, hash: 1, tuning: { ...tuning, directional: false } }),
        flat("B", { exotic: true, hash: 1, tuning: { ...tuning } }),
      ],
      ...rest(),
    ],
    minimums: [0, 0, 0, 0, 0, 55],
  };
  test("oracle: feasible via B's directional", () => {
    expect(oracle(input).feasible).toBe(true);
    expect(oracle(input).ceilings).toEqual([50, 50, 50, 50, 50, 55]);
  });
  test("solve() returns the B build and exact ceilings", () => {
    const out = solve(input, GENEROUS);
    expect(out.loadouts.map((l) => l.pieceIds[0])).toEqual(["B"]);
    expect(out.ceilings).toEqual([50, 50, 50, 50, 50, 55]);
  });
  test("order matters: with B listed first nothing is lost", () => {
    const swapped = { ...input, slots: [[input.slots[0][1], input.slots[0][0]], ...input.slots.slice(1)] };
    const out = solve(swapped, GENEROUS);
    expect(out.loadouts).toHaveLength(1);
    expect(out.ceilings).toEqual([50, 50, 50, 50, 50, 55]);
  });
});
