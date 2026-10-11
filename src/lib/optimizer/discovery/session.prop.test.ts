/**
 * Property discovery for session.ts (runSolveSession + beats) under a stubbed clock that
 * forces capped first passes, starved ceiling phases, and capped/uncapped background
 * re-runs at seed-controlled points. Pools come in two tiers:
 *  - tiny (exhaustive oracle truth);
 *  - large (8–14 pieces/slot so the walk passes its 65,536-node clock checks and really
 *    caps; truth = a cold generous solve, cross-checked by the oracle when small enough).
 * Also runs sessions WITH a carry computed from a previous edit (carryover.ts).
 *
 * Runs: PROP_RUNS (default 60 per tier).
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { solve } from "../solve";
import { beats, runSolveSession, type SessionBudgets } from "../session";
import { computeCeilingCarry } from "../carryover";
import type { CeilingCarry, OptimizerInput, OptimizerOutput } from "../types";
import {
  NS,
  blindSpotQuery,
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

type Ev =
  | { t: "progress"; v: number }
  | { t: "ceilings"; v: number[] }
  | { t: "better"; o: OptimizerOutput }
  | { t: "result"; o: OptimizerOutput; refining: boolean; verified: boolean };

const stats = new Map<string, number>();
const bump = (k: string) => stats.set(k, (stats.get(k) ?? 0) + 1);

function runSession(
  input: OptimizerInput,
  budgets: SessionBudgets,
  step: number,
  carry?: CeilingCarry,
): Ev[] {
  const ev: Ev[] = [];
  withClock(
    () => step,
    () =>
      runSolveSession(
        input,
        {
          onProgress: (v) => ev.push({ t: "progress", v }),
          onCeilings: (v) => ev.push({ t: "ceilings", v: v.slice() }),
          onBetter: (o) => ev.push({ t: "better", o }),
          onResult: (o, refining, verified) => ev.push({ t: "result", o, refining, verified }),
        },
        budgets,
        carry,
      ),
  );
  return ev;
}

function randomBudgets(r: Rnd): SessionBudgets {
  return {
    topNBudgetMs: pick(r, [0, 0, ri(r, 0, 50), ri(r, 0, 2000), 1e9]),
    ceilingBudgetMs: pick(r, [ri(r, 0, 20), ri(r, 0, 300), 1e9]),
    refineCeilingBudgetMs: pick(r, [ri(r, 0, 50), ri(r, 0, 1000), 1e9]),
    refineTopNBudgetMs: pick(r, [ri(r, 0, 100), ri(r, 0, 3000), 1e9]),
  };
}

const combos = (x: OptimizerInput) => x.slots.reduce((a, s) => a * s.length, 1);

function truthCeilings(input: OptimizerInput, cold: OptimizerOutput): number[] {
  if (combos(input) <= 400 || (combos(input) <= 150_000 && process.env.PROP_ORACLE_LARGE)) {
    const t = oracle(input).ceilings;
    expect(cold.ceilings, `cold vs oracle ${describeInput(input)}`).toEqual(t);
    return t;
  }
  expect(cold.ceilingsExact).toBe(true);
  return cold.ceilings;
}

function checkSession(
  input: OptimizerInput,
  ev: Ev[],
  ctx: string,
  carry?: CeilingCarry,
  budgets: SessionBudgets = {},
): void {
  // A zero top-N budget (test-only; production never passes one) divides 0/0 into NaN
  // progress — see FINDING N1 / the "NaN progress" repro below.
  const zeroTopNBudget = budgets.topNBudgetMs === 0 || budgets.refineTopNBudgetMs === 0;
  const cold = solve(input, GEN);
  expect(cold.capped).toBe(false);
  const truth = truthCeilings(input, cold);
  const results = ev.flatMap((e, i) => (e.t === "result" ? [{ ...e, i }] : []));
  const better = ev.flatMap((e, i) => (e.t === "better" ? [{ ...e, i }] : []));
  const finals = results.filter((x) => !x.refining);
  expect(finals.length, `${ctx}: exactly one final`).toBe(1);
  const final = results[results.length - 1];
  expect(final.refining, `${ctx}: last post is final`).toBe(false);
  const first = results[0];
  // Interim post iff not (uncapped && exact).
  const needInterim = !( !first.o.capped && first.o.ceilingsExact);
  expect(results.length, `${ctx}: post count`).toBe(needInterim ? 2 : 1);
  if (needInterim) {
    expect(first.refining, ctx).toBe(true);
    expect(first.verified, `${ctx}: interim verified ⇔ uncapped`).toBe(!first.o.capped);
  } else expect(first.verified, ctx).toBe(true);
  bump(`posts=${results.length} firstCapped=${first.o.capped} firstExact=${first.o.ceilingsExact} better=${better.length} finalVerified=${final.verified} finalExact=${final.o.ceilingsExact}${carry ? " carry" : ""}`);
  // Frozen list.
  expect(final.o.loadouts, `${ctx}: frozen`).toEqual(first.o.loadouts);
  for (const lo of first.o.loadouts) expect(loadoutError(lo, input), ctx).toBeNull();
  // Better: at most once, before the final, strictly better.
  expect(better.length, ctx).toBeLessThanOrEqual(1);
  for (const b of better) {
    expect(b.i, `${ctx}: better before final`).toBeLessThan(final.i);
    expect(b.i, `${ctx}: better after interim`).toBeGreaterThan(first.i);
    expect(beats(b.o, first.o), `${ctx}: offered list must beat`).toBe(true);
    expect(strictlyBetter(b.o, first.o), `${ctx}: offered list must be strictly better (independent)`).toBe(true);
    // Seeded with the frozen list, the background list dominates it rank-wise.
    for (let i = 0; i < first.o.loadouts.length; i++)
      expect(b.o.loadouts[i]?.total ?? -1, `${ctx}: offer rank ${i} below frozen`).toBeGreaterThanOrEqual(first.o.loadouts[i].total);
    for (const lo of b.o.loadouts) expect(loadoutError(lo, input), ctx).toBeNull();
    const keys = b.o.loadouts.map((l) => l.pieceIds.join("|"));
    expect(new Set(keys).size, `${ctx}: offered dupes`).toBe(keys.length);
    expect(b.o.ceilings, `${ctx}: offer carries final ceilings`).toEqual(final.o.ceilings);
  }
  // Verified ⇒ no better list exists.
  const coldTotals = cold.loadouts.map((l) => l.total);
  if (final.verified) {
    if (better.length) expect(better[0].o.loadouts.map((l) => l.total), `${ctx}: verified offer = cold`).toEqual(coldTotals);
    else expect(final.o.loadouts.map((l) => l.total), `${ctx}: verified list = cold\n${describeInput(input)}`).toEqual(coldTotals);
  }
  // A non-beating, exhaustive background pass must coincide with cold; and conversely if
  // the posted list differs from cold while the background ran to exhaustion, an offer fired.
  if (first.o.capped && final.verified && !better.length) bump("capped→verified no offer");
  // onBetter iff beats: once the background walk was exhaustive its list equals the cold
  // list, so an offer must fire exactly when cold's totals strictly beat the frozen list.
  if (first.o.capped && final.verified) {
    const shouldOffer = strictlyBetter(cold, first.o);
    if (shouldOffer) {
      const n = first.o.loadouts.length;
      const sameTop = cold.loadouts.slice(0, n).every((l, i) => l.total === first.o.loadouts[i].total);
      bump(sameTop ? "offer by length only (QUESTION Q2)" : "offer by rank");
    }
    expect(better.length, `${ctx}: offer iff cold strictly beats the frozen list`).toBe(shouldOffer ? 1 : 0);
  }
  if (first.o.capped && !first.o.ceilingsExact && budgets.refineCeilingBudgetMs === 0 && final.o.ceilingsExact) bump("phase 2 closed the ceiling gap");
  // A generous background ceiling phase must prove every ceiling.
  if (results.length === 2 && (budgets.refineCeilingBudgetMs ?? 15_000) >= 1e9)
    expect(final.o.ceilingsExact, `${ctx}: generous refinement left ceilings inexact`).toBe(true);
  // The background progress bar completes.
  if (results.length === 2) {
    const after = ev.slice(first.i + 1, final.i).flatMap((e) => (e.t === "progress" ? [e.v] : []));
    if (!(zeroTopNBudget && after.some(Number.isNaN)))
      expect(after.at(-1), `${ctx}: background progress ends at 1`).toBe(1);
  }
  if (first.o.capped && better.length) bump("offer fired");
  // Honest ceilings on every post + offer.
  for (const x of [...results, ...better]) {
    for (let s = 0; s < NS; s++) {
      expect(x.o.ceilings[s], `${ctx}: ceiling ${s} over truth`).toBeLessThanOrEqual(truth[s]);
      expect(x.o.ceilingUppers[s], `${ctx}: upper ${s} under truth\ninput=${describeInput(input)}\ncarry=${JSON.stringify(carry)}`).toBeGreaterThanOrEqual(truth[s]);
    }
    const eq = x.o.ceilings.every((v, s) => v === x.o.ceilingUppers[s]);
    expect(x.o.ceilingsExact, `${ctx}: exact ⇔ equal`).toBe(eq);
  }
  // Final ceilings never below interim.
  for (let s = 0; s < NS; s++) expect(final.o.ceilings[s], ctx).toBeGreaterThanOrEqual(first.o.ceilings[s]);
  // Streamed ceilings never over truth.
  for (const e of ev) if (e.t === "ceilings") for (let s = 0; s < NS; s++) expect(e.v[s], `${ctx}: streamed ceiling`).toBeLessThanOrEqual(truth[s]);
  // Progress: finite, in [0,1], monotone before the interim post and after it.
  const segs: number[][] = [[], []];
  let seg = 0;
  for (const e of ev) {
    if (e.t === "result") seg = 1;
    if (e.t === "progress") segs[seg].push(e.v);
  }
  for (const sg of segs) {
    if (zeroTopNBudget && sg.some((v) => Number.isNaN(v))) {
      bump("NaN progress (zero topN budget, test-only)");
      continue;
    }
    for (let i = 0; i < sg.length; i++) {
      expect(Number.isFinite(sg[i]), `${ctx}: progress finite (${sg[i]})`).toBe(true);
      expect(sg[i], ctx).toBeGreaterThanOrEqual(0);
      expect(sg[i], ctx).toBeLessThanOrEqual(1);
      if (i) expect(sg[i], `${ctx}: progress monotone ${sg.slice(Math.max(0, i - 3), i + 1)}`).toBeGreaterThanOrEqual(sg[i - 1]);
    }
  }
}

/** Independent restatement of "rank-wise strictly better" (not session.beats). */
function strictlyBetter(next: OptimizerOutput, prev: OptimizerOutput): boolean {
  if (next.loadouts.length > prev.loadouts.length) return true;
  for (let i = 0; i < next.loadouts.length; i++) if (next.loadouts[i].total > prev.loadouts[i].total) return true;
  return false;
}

function largeQuery(r: Rnd): OptimizerInput {
  if (chance(r, 0.7)) return blindSpotQuery(r);
  const q = randomQuery(r, 14, 8, 6);
  // Keep the big tier's walk long: few tight constraints.
  if (chance(r, 0.7)) q.minimums = q.minimums.map((m) => (chance(r, 0.6) ? 0 : Math.max(0, m - 20)));
  if (chance(r, 0.6)) q.setRequirements = undefined;
  if (chance(r, 0.6)) q.powerRange = undefined;
  if (chance(r, 0.5)) q.allowTuning = false;
  return q;
}

describe("session discovery", () => {
  test("tiny pools: session contract under a stubbed clock", () => {
    stats.clear();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const r = rng(seed);
        const input = randomQuery(r, 3);
        const budgets = randomBudgets(r);
        const step = pick(r, [0, 0.25, 1, 5]);
        const ev = runSession(input, budgets, step);
        checkSession(input, ev, `tiny seed=${seed} budgets=${JSON.stringify(budgets)} step=${step}`, undefined, budgets);
      }),
      { numRuns: RUNS * 2 },
    );
    console.log([...stats.entries()].sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
  }, 300_000);

  test("large pools: capped first passes, background re-run, offers", () => {
    stats.clear();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const r = rng(seed);
        const input = largeQuery(r);
        // Bias toward capping the first walk (the only way into phase 2).
        const budgets = { ...randomBudgets(r), topNBudgetMs: pick(r, [0, 0, 0, ri(r, 0, 20), ri(r, 0, 200), 1e9]) };
        if (chance(r, 0.5)) budgets.refineTopNBudgetMs = 1e9;
        else if (chance(r, 0.5)) budgets.refineTopNBudgetMs = 0;
        // Profile: phase 1 gets nothing, phase 2 is exhaustive — phase 2 alone must close ceilings.
        if (chance(r, 0.25)) Object.assign(budgets, { topNBudgetMs: 0, ceilingBudgetMs: ri(r, 0, 30), refineCeilingBudgetMs: 0, refineTopNBudgetMs: 1e9 });
        const step = pick(r, [0.25, 1, 5, 0]);
        const ev = runSession(input, budgets, step);
        checkSession(input, ev, `large seed=${seed} budgets=${JSON.stringify(budgets)} step=${step}`, undefined, budgets);
      }),
      { numRuns: Math.ceil(RUNS / 2) },
    );
    console.log([...stats.entries()].sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
  }, 600_000);

  test("sessions with a carried seed from the previous edit", () => {
    stats.clear();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const r = rng(seed);
        const big = chance(r, 0.3);
        let input = big ? largeQuery(r) : randomQuery(r, 3);
        let prevOut: OptimizerOutput | undefined;
        for (let step = 0; step < 4; step++) {
          const edit = randomEdit(r, input);
          // Previous output: a starved session's interim or final post.
          if (!prevOut) {
            const ev = runSession(input, randomBudgets(r), pick(r, [0, 0.25, 1, 5]));
            const posts = ev.flatMap((e) => (e.t === "result" ? [e.o] : []));
            prevOut = chance(r, 0.5) ? posts[0] : posts[posts.length - 1];
          }
          const carry = computeCeilingCarry(input, prevOut, edit.next);
          const budgets = randomBudgets(r);
          const clk = pick(r, [0, 0.25, 1, 5]);
          const ev = runSession(edit.next, budgets, clk, carry);
          checkSession(edit.next, ev, `carry seed=${seed} step=${step} edit=${edit.kind} budgets=${JSON.stringify(budgets)} clk=${clk}`, carry, budgets);
          const posts = ev.flatMap((e) => (e.t === "result" ? [e.o] : []));
          prevOut = chance(r, 0.5) ? posts[0] : posts[posts.length - 1];
          input = edit.next;
        }
      }),
      { numRuns: RUNS },
    );
    console.log([...stats.entries()].sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
  }, 600_000);

  test("a carry never changes a generous session's answer", () => {
    let carried = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const r = rng(seed);
        const input = randomQuery(r, 3);
        const ev0 = runSession(input, randomBudgets(r), pick(r, [0, 0.25, 1, 5]));
        const posts0 = ev0.flatMap((e) => (e.t === "result" ? [e.o] : []));
        const prevOut = chance(r, 0.5) ? posts0[0] : posts0[posts0.length - 1];
        const edit = randomEdit(r, input);
        const carry = computeCeilingCarry(input, prevOut, edit.next);
        if (!carry) return;
        carried++;
        const final = (c?: CeilingCarry) => {
          const ev = runSession(edit.next, { topNBudgetMs: 1e9, ceilingBudgetMs: 1e9 }, 1, c);
          return ev.flatMap((e) => (e.t === "result" ? [e.o] : [])).at(-1)!;
        };
        const a = final(carry);
        const b = final(undefined);
        const sig = (o: OptimizerOutput) => ({
          ids: o.loadouts.map((l) => l.pieceIds.join("|")),
          totals: o.loadouts.map((l) => l.total),
          c: o.ceilings,
          u: o.ceilingUppers,
          x: o.ceilingsExact,
        });
        expect(sig(a), `seed=${seed} edit=${edit.kind}`).toEqual(sig(b));
      }),
      { numRuns: RUNS * 2 },
    );
    console.log(`carry-vs-cold sessions with a carry: ${carried}`);
  }, 300_000);
});
