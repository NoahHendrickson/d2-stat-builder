/**
 * Property discovery for carryover.ts: edit-history chains over tiny pools, checked against
 * the independent exhaustive oracle in carry-harness.ts.
 *
 *  - oracle calibration: generous solve vs oracle (feasibility, legality, ceilings for
 *    feasible AND infeasible queries).
 *  - carry soundness: every returned carry seed ≤ truth ≤ every carried upper seed, and a
 *    carried re-solve lands honest bounds that agree with a cold solve.
 *  - comparator metamorphic: sameQueryExceptMinimums(a,b) ⇒ solve(b) ≡ solve({...a, minimums: b.minimums}).
 *
 * Runs: PROP_RUNS (default 60 chains of 8 edits).
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { solve } from "../solve";
import { computeCeilingCarry, sameQueryExceptMinimums } from "../carryover";
import { runSolveSession } from "../session";
import type { CeilingCarry, OptimizerInput, OptimizerOutput } from "../types";
import {
  NS,
  chance,
  describeInput,
  loadoutError,
  oracle,
  pick,
  randomEdit,
  randomQuery,
  ri,
  rng,
  withClock,
  type Rnd,
} from "./carry-harness";

const RUNS = Number(process.env.PROP_RUNS ?? 60);
const GEN = { topNBudgetMs: 1e9, ceilingBudgetMs: 1e9 };

export const stats = new Map<string, number>();
const bump = (k: string, n = 1) => stats.set(k, (stats.get(k) ?? 0) + n);

/** Honest-bounds check of an output against the oracle truth. Returns an error or null. */
function boundsError(out: OptimizerOutput, truth: number[]): string | null {
  for (let s = 0; s < NS; s++) {
    if (out.ceilings[s] > truth[s]) return `ceiling ${s}=${out.ceilings[s]} > truth ${truth[s]}`;
    if (out.ceilingUppers[s] < truth[s]) return `upper ${s}=${out.ceilingUppers[s]} < truth ${truth[s]}`;
  }
  const eq = out.ceilings.every((v, s) => v === out.ceilingUppers[s]);
  if (eq !== out.ceilingsExact) return `exact flag ${out.ceilingsExact} but equality ${eq}`;
  return null;
}

/**
 * Produce the "previous output" the store would hold for `input`: a generous solve, a
 * clock-starved one (inexact ceilings, possibly capped walk), the interim or final post
 * of a starved session, or a generous output with its list truncated (a capped walk's
 * list is some subset of legal builds).
 */
function prevOutput(r: Rnd, input: OptimizerInput, carry?: CeilingCarry): { out: OptimizerOutput; how: string } {
  const how = pick(r, ["generous", "starved", "starvedSession", "interim", "truncated"] as const);
  const seeds = { ceilingSeed: carry?.ceilingSeed, ceilingUpperSeed: carry?.ceilingUpperSeed };
  switch (how) {
    case "generous":
      return { out: solve(input, { ...GEN, ...seeds }), how };
    case "starved": {
      const step = pick(r, [0.5, 1, 3, 10]);
      const out = withClock(
        () => step,
        () => solve(input, { topNBudgetMs: ri(r, 0, 40), ceilingBudgetMs: ri(r, 0, 30), ...seeds }),
      );
      return { out, how };
    }
    case "starvedSession":
    case "interim": {
      const posts: OptimizerOutput[] = [];
      const step = pick(r, [0.5, 1, 3, 10]);
      withClock(
        () => step,
        () =>
          runSolveSession(
            input,
            {
              onProgress: () => {},
              onCeilings: () => {},
              onBetter: () => {},
              onResult: (o) => posts.push(o),
            },
            {
              topNBudgetMs: ri(r, 0, 40),
              ceilingBudgetMs: ri(r, 0, 30),
              refineCeilingBudgetMs: ri(r, 0, 60),
              refineTopNBudgetMs: ri(r, 0, 200),
            },
            carry,
          ),
      );
      return { out: how === "interim" ? posts[0] : posts[posts.length - 1], how };
    }
    case "truncated": {
      const out = solve(input, { ...GEN, ...seeds });
      const keep = ri(r, 0, out.loadouts.length);
      return { out: { ...out, loadouts: out.loadouts.slice(0, keep), capped: true }, how };
    }
  }
}

function runChain(seed: number, steps: number): void {
  const r = rng(seed);
  let input = randomQuery(r, chance(r, 0.35) ? 5 : 3);
  let carryIn: CeilingCarry | undefined;
  let prev = prevOutput(r, input, carryIn);
  for (let step = 0; step < steps; step++) {
    const ctx = () => `seed=${seed} step=${step}`;
    const truthPrev = oracle(input);
    bump(`prev ${prev.how} capped=${prev.out.capped} exact=${prev.out.ceilingsExact}`);
    // The previous output itself must be honest (it is what the carry is built from).
    const pe = boundsError(prev.out, truthPrev.ceilings);
    expect(pe, `${ctx()} prev(${prev.how}) ${pe}\ninput=${describeInput(input)}\ncarry=${JSON.stringify(carryIn)}`).toBeNull();
    for (const lo of prev.out.loadouts) expect(loadoutError(lo, input), ctx()).toBeNull();

    const edit = randomEdit(r, input);
    const next = edit.next;
    const same = sameQueryExceptMinimums(input, next);
    bump(`edit ${edit.kind.split("+")[0].split(":")[0]} same=${same}`);
    if (process.env.PROP_EDIT_STATS) bump(`kind ${edit.kind.split("+")[0]}${input.powerRange ? " [range]" : ""}`);
    if (edit.minsOnly) expect(same, `${ctx()} mins-only edit reported different`).toBe(true);
    if (edit.noop && !edit.minsOnly) {
      bump(same ? "noop recognised" : "noop missed");
      if (!same) bump(`noop missed: ${edit.kind}`);
    }

    // Metamorphic: same-query ⇒ the solver can't tell b from a-with-b's-minimums.
    if (same) {
      const viaA = solve({ ...input, minimums: next.minimums }, GEN);
      const viaB = solve(next, GEN);
      const sig = (o: OptimizerOutput) => ({
        totals: o.loadouts.map((l) => l.total),
        stats: o.loadouts.map((l) => l.stats.join(",")),
        power: o.loadouts.map((l) => l.power),
        ceilings: o.ceilings,
        uppers: o.ceilingUppers,
        exact: o.ceilingsExact,
      });
      expect(sig(viaB), `${ctx()} metamorphic (${edit.kind})\nA=${describeInput(input)}\nB=${describeInput(next)}`).toEqual(sig(viaA));
    }

    const carry = computeCeilingCarry(input, prev.out, next);
    const truth = oracle(next);
    bump(truth.feasible ? "next feasible" : "next infeasible");
    if (next.powerRange) bump("next has powerRange");
    if ((next.setRequirements ?? []).length) bump("next has setReqs");
    if (carry) {
      bump(`carry ${carry.ceilingSeed ? "L" : "-"}${carry.ceilingUpperSeed ? "U" : "-"} from ${prev.how}`);
      for (let s = 0; s < NS; s++) {
        if (carry.ceilingSeed)
          expect(
            carry.ceilingSeed[s],
            `${ctx()} carried seed ${s} over truth (${edit.kind}, prev ${prev.how})\nprev=${describeInput(input)}\nnext=${describeInput(next)}\nprevOut=${JSON.stringify(prev.out)}\ntruth=${truth.ceilings}`,
          ).toBeLessThanOrEqual(truth.ceilings[s]);
        if (carry.ceilingUpperSeed)
          expect(
            carry.ceilingUpperSeed[s],
            `${ctx()} carried upper ${s} under truth (${edit.kind}, prev ${prev.how})\nprev=${describeInput(input)}\nnext=${describeInput(next)}\nprevOut=${JSON.stringify(prev.out)}\ntruth=${truth.ceilings}`,
          ).toBeGreaterThanOrEqual(truth.ceilings[s]);
      }
      const seeded = solve(next, { ...GEN, ceilingSeed: carry.ceilingSeed, ceilingUpperSeed: carry.ceilingUpperSeed });
      const cold = solve(next, GEN);
      expect(boundsError(seeded, truth.ceilings), `${ctx()} seeded`).toBeNull();
      expect(boundsError(cold, truth.ceilings), `${ctx()} cold\nnext=${describeInput(next)}`).toBeNull();
      if (seeded.ceilingsExact && cold.ceilingsExact) expect(seeded.ceilings, ctx()).toEqual(cold.ceilings);
      if (seeded.ceilingsExact) expect(seeded.ceilings, ctx()).toEqual(truth.ceilings);
      expect(seeded.loadouts.map((l) => l.total), ctx()).toEqual(cold.loadouts.map((l) => l.total));
    } else bump(`no carry (${same ? "same" : "diff"})`);

    input = next;
    carryIn = carry;
    prev = prevOutput(r, input, carryIn);
  }
}

describe("carryover discovery", () => {
  test("oracle calibration: generous solve agrees with the oracle (incl. infeasible ceilings)", () => {
    let feasible = 0;
    let infeasibleChecked = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const r = rng(seed);
        const input = randomQuery(r);
        const truth = oracle(input);
        const out = solve(input, GEN);
        const ctx = `seed=${seed} input=${describeInput(input)}`;
        expect(out.capped, ctx).toBe(false);
        expect(out.loadouts.length > 0, `${ctx} feasibility`).toBe(truth.feasible);
        for (const lo of out.loadouts) expect(loadoutError(lo, input), ctx).toBeNull();
        if (truth.feasible) feasible++;
        else infeasibleChecked++;
        expect(boundsError(out, truth.ceilings), ctx).toBeNull();
        if (out.ceilingsExact) expect(out.ceilings, ctx).toEqual(truth.ceilings);
      }),
      { numRuns: RUNS * 4 },
    );
    console.log(`calibration: feasible=${feasible} infeasible=${infeasibleChecked}`);
  }, 120_000);

  test("edit chains: carry soundness + same-query metamorphic", () => {
    stats.clear();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => runChain(seed, 8)),
      { numRuns: RUNS },
    );
    console.log([...stats.entries()].sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
  }, 300_000);
});

void chance;
