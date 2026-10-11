/**
 * Discovery: honesty of optimizer results under time pressure and seeding — fault
 * injection through a deterministic, adversarial `performance.now` (see
 * docs/proptest/BRIEF.md and time-oracle.ts).
 *
 * Contracts checked on every run (capped or not, exact or not, feasible or not):
 *  - ceilings[s] ≤ truth[s] ≤ ceilingUppers[s]  (truth = max of stat s subject to the
 *    OTHER five minimums, from the independent oracle; the frozen-clock cold run for
 *    `big` pools, which the oracle-sized shapes validate);
 *  - ceilingsExact ⇔ ceilings == uppers; exact ⇒ ceilings == truth;
 *  - every build legal + distinct; capped:false ⇒ totals == the cold run's totals;
 *    capped totals pointwise ≤ cold totals; a build both runs return has equal totals;
 *  - nothing throws (the "ceiling invariant violated" guard included);
 *  - streamed ceilings are achievable and monotone.
 *
 * PROP_RUNS scales the run counts; PROP_VERBOSE prints coverage stats; PROP_SEED pins.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import fc from "fast-check";
import { solve } from "../solve";
import { solveCeilings } from "../ceilings";
import { runSolveSession } from "../session";
import { computeCeilingCarry } from "../carryover";
import { NUM_STATS } from "../floors";
import type { OptimizerInput, OptimizerOutput } from "../types";
import {
  FakeClock,
  ORACLE_SHAPES,
  arbClockPlan,
  arbQuerySpec,
  buildQuery,
  loadoutError,
  oracle,
  withoutJumps,
  type ClockPlan,
  type ClockSite,
  type PoolShape,
  type QuerySpec,
} from "./time-oracle";

const RUNS = Number(process.env.PROP_RUNS ?? 40);
const VERBOSE = !!process.env.PROP_VERBOSE;
const SEED = process.env.PROP_SEED ? Number(process.env.PROP_SEED) : undefined;
const fcOpts = (numRuns: number) => ({ numRuns, seed: SEED, endOnFailure: !!process.env.PROP_NOSHRINK });

// Property runs are synchronous and can take tens of seconds under PROP_RUNS.
vi.setConfig({ testTimeout: 600_000 });

afterEach(() => {
  vi.restoreAllMocks();
});

export function withClock<T>(clock: FakeClock, f: () => T): T {
  const spy = vi.spyOn(performance, "now").mockImplementation(clock.now);
  try {
    return f();
  } finally {
    spy.mockRestore();
  }
}

const GENEROUS = { topNBudgetMs: 1e12, ceilingBudgetMs: 1e12 };

interface Truth {
  feasible: boolean;
  ceilings: number[];
  fromOracle: boolean;
}
interface Cached {
  truth: Truth;
  cold: OptimizerOutput;
}
const cache = new Map<string, Cached>();
function prepare(input: OptimizerInput, shape: PoolShape): Cached {
  const key = JSON.stringify(input);
  let c = cache.get(key);
  if (!c) {
    // A frozen clock never expires: the "infinitely generous" reference run.
    const cold = withClock(new FakeClock(null), () => solve(input, GENEROUS));
    let truth: Truth;
    if (ORACLE_SHAPES.includes(shape)) {
      const o = oracle(input);
      truth = { feasible: o.feasible, ceilings: o.ceilings, fromOracle: true };
    } else {
      truth = { feasible: cold.loadouts.length > 0, ceilings: cold.ceilings, fromOracle: false };
    }
    c = { truth, cold };
    cache.set(key, c);
  }
  return c;
}

function ceilingViolations(
  out: { ceilings: number[]; ceilingUppers: number[]; ceilingsExact: boolean },
  c: Cached,
): string[] {
  const v: string[] = [];
  const tag = c.truth.feasible ? "feasible" : "infeasible";
  const truth = c.truth.ceilings;
  for (let s = 0; s < NUM_STATS; s++) {
    if (out.ceilings[s] > truth[s]) v.push(`${tag}: ceiling[${s}]=${out.ceilings[s]} > truth ${truth[s]}`);
    if (out.ceilingUppers[s] < truth[s]) v.push(`${tag}: upper[${s}]=${out.ceilingUppers[s]} < truth ${truth[s]}`);
  }
  const eq = out.ceilings.every((x, s) => x === out.ceilingUppers[s]);
  if (out.ceilingsExact !== eq) v.push(`${tag}: exact=${out.ceilingsExact} but equality=${eq}`);
  if (out.ceilingsExact && out.ceilings.join() !== truth.join())
    v.push(`${tag}: exact ceilings ${out.ceilings} != truth ${truth}`);
  return v;
}

function buildViolations(input: OptimizerInput, out: OptimizerOutput, c: Cached, compareToCold = true): string[] {
  const v: string[] = [];
  const tag = c.truth.feasible ? "feasible" : "infeasible";
  const keys = new Set<string>();
  for (const lo of out.loadouts) {
    const e = loadoutError(lo, input);
    if (e) v.push(`${tag}: illegal loadout ${lo.pieceIds}: ${e}`);
    const k = lo.pieceIds.join("|");
    if (keys.has(k)) v.push(`${tag}: duplicate loadout ${k}`);
    keys.add(k);
  }
  if (out.loadouts.length > 0 && !c.truth.feasible) v.push(`${tag}: builds on infeasible query`);
  if (out.loadouts.length > (input.maxResults ?? 200)) v.push(`${tag}: more than maxResults`);
  if (!compareToCold) return v;
  const coldTotals = c.cold.loadouts.map((l) => l.total);
  const totals = out.loadouts.map((l) => l.total);
  if (!out.capped && totals.join() !== coldTotals.join())
    v.push(`${tag}: uncapped totals [${totals}] != cold [${coldTotals}]`);
  totals.forEach((t, i) => {
    if (i >= coldTotals.length || t > coldTotals[i]) v.push(`${tag}: total #${i}=${t} beats cold ${coldTotals[i]}`);
  });
  const coldByKey = new Map(c.cold.loadouts.map((l) => [l.pieceIds.join("|"), l.total]));
  for (const lo of out.loadouts) {
    const ct = coldByKey.get(lo.pieceIds.join("|"));
    if (ct !== undefined && ct !== lo.total) v.push(`${tag}: build ${lo.pieceIds} total ${lo.total} vs cold ${ct}`);
  }
  return v;
}

const fail = (v: string[], ctx: unknown): void => {
  if (v.length) throw new Error(`${v.join("\n")}\nCASE ${JSON.stringify(ctx)}`);
};

/** Run `f` twice: once jump-free to count clock calls, then with jumps inside that run. */
function adversarial<T>(plan: ClockPlan, f: () => T, sites?: Record<string, number>): { out: T; clock: FakeClock } {
  const probe = new FakeClock(withoutJumps(plan));
  if (plan.jumps.some((j) => j.site)) probe.siteLog = [];
  withClock(probe, f);
  const clock = new FakeClock(plan, probe.calls, !!sites, probe.siteLog);
  const out = withClock(clock, f);
  if (sites) for (const s of clock.jumpSites) sites[s] = (sites[s] ?? 0) + 1;
  return { out, clock };
}

const arbBudget = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 400 }),
  fc.constant(1e9),
);
const ALL_SHAPES: PoolShape[] = ["tiny", "tiny", "wide", "wide", "huge", "tunerHeavy", "big", "tunerBig", "tunerBig", "emptySlot", "ineligibleSlot"];
const arbCase = arbQuerySpec(ALL_SHAPES);
const stat = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
const log = (o: unknown) => VERBOSE && process.stderr.write(JSON.stringify(o) + "\n");

describe("reference runs (frozen clock = infinite budget) agree with the oracle", () => {
  test("uncapped, exact, ceilings == oracle truth (feasible AND infeasible queries)", () => {
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(arbQuerySpec(ORACLE_SHAPES), (spec) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        stat(m, c.truth.feasible ? "feasible" : "infeasible");
        stat(m, spec.shape);
        if (input.powerRange) stat(m, "power");
        if (input.setRequirements?.length) stat(m, "setReq");
        expect(c.cold.capped).toBe(false);
        expect(c.cold.ceilingsExact).toBe(true);
        fail([...ceilingViolations(c.cold, c), ...buildViolations(input, c.cold, c, false)], { input });
      }),
      fcOpts(RUNS * 2),
    );
    log({ reference: m });
  });
});

describe("solve() under an adversarial clock", () => {
  test("honest ceilings, exhaustive-iff-uncapped, legal builds, no throw", () => {
    const sites: Record<string, number> = {};
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(arbCase, arbClockPlan, arbBudget, arbBudget, fc.boolean(), (spec: QuerySpec, plan, topN, ceil, cbs) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        let streamed: number[][] = [];
        const run = () => {
          streamed = [];
          return solve(input, {
            topNBudgetMs: topN,
            ceilingBudgetMs: ceil,
            ...(cbs ? { onProgress: () => {}, onCeilings: (cs: number[]) => streamed.push(cs.slice()) } : {}),
          });
        };
        const { out } = adversarial(plan, run, VERBOSE ? sites : undefined);
        stat(m, out.capped ? "capped" : "uncapped");
        stat(m, out.ceilingsExact ? "exact" : "inexact");
        stat(m, c.truth.feasible ? "feasible" : "infeasible");
        const v = [...ceilingViolations(out, c), ...buildViolations(input, out, c)];
        for (let i = 0; i < streamed.length; i++) {
          for (let s = 0; s < NUM_STATS; s++) {
            if (streamed[i][s] > c.truth.ceilings[s]) v.push(`streamed frame ${i} stat ${s} > truth`);
            if (i > 0 && streamed[i][s] < streamed[i - 1][s]) v.push(`streamed frame ${i} stat ${s} regressed`);
          }
        }
        fail(v, { input, plan, topN, ceil, cbs });
      }),
      fcOpts(RUNS * 4),
    );
    log({ solveAdversarial: m, jumpSites: sites });
  });
});

/** A valid achievable seed (≤ truth per stat) and a valid proven upper seed (≥ truth). */
const arbSeeds = fc.record({
  lowFrac: fc.array(fc.integer({ min: 0, max: 4 }).map((x) => x / 4), { minLength: 6, maxLength: 6 }),
  upperMode: fc.constantFrom("none", "truth", "above"),
  upperExtra: fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 6, maxLength: 6 }),
});
const mkSeeds = (truth: number[], s: { lowFrac: number[]; upperMode: string; upperExtra: number[] }) => ({
  seed: truth.map((t, i) => Math.floor(t * s.lowFrac[i])),
  upperSeed:
    s.upperMode === "none" ? undefined : s.upperMode === "truth" ? truth.slice() : truth.map((t, i) => t + s.upperExtra[i]),
});

describe("solveCeilings() seeding under an adversarial clock", () => {
  test("seeded refinement stays honest; stats add up; never throws", () => {
    const sites: Record<string, number> = {};
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(arbCase, arbSeeds, arbClockPlan, arbBudget, (spec, sd, plan, budget) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const { seed, upperSeed } = mkSeeds(c.truth.ceilings, sd);
        const streamed: number[][] = [];
        const { out: r } = adversarial(
          plan,
          () => solveCeilings(input, seed, budget, { upperSeed, onCeilings: (x) => streamed.push(x.slice()) }),
          VERBOSE ? sites : undefined,
        );
        stat(m, r.exact ? "exact" : "inexact");
        stat(m, `upper:${sd.upperMode}`);
        if (r.stats.timedOut) stat(m, "timedOut>0");
        const v = ceilingViolations({ ceilings: r.ceilings, ceilingUppers: r.uppers, ceilingsExact: r.exact }, c);
        const st = r.stats;
        if (st.feasible + st.disproven + st.timedOut !== st.probes) v.push(`stats don't add up ${JSON.stringify(st)}`);
        for (let s = 0; s < NUM_STATS; s++) if (r.ceilings[s] < seed[s]) v.push(`ceiling[${s}] fell below seed`);
        for (const f of streamed) for (let s = 0; s < NUM_STATS; s++) if (f[s] > c.truth.ceilings[s]) v.push("streamed > truth");
        fail(v, { input, seed, upperSeed, plan, budget });
      }),
      fcOpts(RUNS * 4),
    );
    log({ solveCeilingsAdversarial: m, jumpSites: sites });
  });

  test("seed == truth and upperSeed == truth ⇒ exact with zero probes, any budget", () => {
    fc.assert(
      fc.property(arbCase, arbClockPlan, arbBudget, (spec, plan, budget) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const t = c.truth.ceilings;
        const { out: r } = adversarial(plan, () => solveCeilings(input, t.slice(), budget, { upperSeed: t.slice() }));
        const degenerate = input.slots.some((s) => s.length === 0) || r.uppers.every((u) => u === 200);
        if (degenerate) return; // degenerate pool: documented STAT_CAP uppers, exact false
        fail(
          [
            ...ceilingViolations({ ceilings: r.ceilings, ceilingUppers: r.uppers, ceilingsExact: r.exact }, c),
            ...(r.exact ? [] : ["not exact"]),
            ...(r.stats.probes === 0 ? [] : [`${r.stats.probes} probes`]),
          ],
          { input, budget, plan },
        );
      }),
      fcOpts(RUNS * 2),
    );
  });

  test("a single transient stall costs at most one probe (timeouts are per-probe)", () => {
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(
        arbQuerySpec(["tunerBig", "big", "wide", "huge"]),
        fc.constantFrom<ClockSite>("probe-walk", "probe-tuner", "probe-loop"),
        fc.integer({ min: 0, max: 1000 }),
        (spec, site, frac) => {
          const input = buildQuery(spec);
          const c = prepare(input, spec.shape);
          // Frozen clock except ONE 500 s stall (> any probe share once ≥2 stats are pending);
          // the 1000 s budget is never exhausted, so every later probe runs to completion.
          const plan: ClockPlan = { incs: [0], jumps: [{ frac: frac / 1000, by: 5e5, site }] };
          const { out: r } = adversarial(plan, () => solveCeilings(input, [0, 0, 0, 0, 0, 0], 1e6));
          stat(m, `timedOut:${r.stats.timedOut}`);
          const v = ceilingViolations({ ceilings: r.ceilings, ceilingUppers: r.uppers, ceilingsExact: r.exact }, c);
          if (r.stats.timedOut > 1) v.push(`${r.stats.timedOut} probes timed out from one stall`);
          fail(v, { input, plan });
        },
      ),
      fcOpts(RUNS),
    );
    log({ transientStall: m });
  });

  test("documented defence: an upperSeed below the (true) seed is lifted to the seed", () => {
    // Contract: upperSeed MUST be proven; this pins the documented defence anyway ("never
    // below the seed's own achievable ceiling"). Seed = truth, so nothing can be harvested
    // above it and the defended result is exact with no probes.
    fc.assert(
      fc.property(arbCase, fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 6, maxLength: 6 }), arbClockPlan, arbBudget, (spec, fr, plan, budget) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const seed = c.truth.ceilings.slice();
        const bogus = seed.map((t, i) => Math.floor((t * fr[i]) / 5));
        const { out: r } = adversarial(plan, () => solveCeilings(input, seed, budget, { upperSeed: bogus }));
        if (r.uppers.every((u) => u === 200) && r.stats.probes === 0 && !r.exact) return; // degenerate pool
        const v: string[] = [];
        for (let s = 0; s < NUM_STATS; s++) if (r.ceilings[s] > r.uppers[s]) v.push(`ceiling[${s}] > upper`);
        if (!r.exact) v.push("not exact");
        fail(v, { input, seed, bogus, plan, budget });
      }),
      fcOpts(RUNS),
    );
  });

  test("QUESTION: an upperSeed below the TRUTH (but ≥ seed) throws the invariant in dev", () => {
    // Out of contract (upperSeed must be proven) — recorded to document behaviour: a
    // witness harvest lifts a stat past the bogus upper and reconcileCeilingBounds throws
    // outside production. Not a finding unless some caller can produce such a seed.
    const outcomes: Record<string, number> = {};
    fc.assert(
      fc.property(arbCase, arbSeeds, fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 6, maxLength: 6 }), (spec, sd, bogus) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const { seed } = mkSeeds(c.truth.ceilings, sd);
        try {
          const r = withClock(new FakeClock(null), () => solveCeilings(input, seed, 1e12, { upperSeed: bogus }));
          for (let s = 0; s < NUM_STATS; s++) expect(r.ceilings[s]).toBeLessThanOrEqual(c.truth.ceilings[s]);
          stat(outcomes, "returned");
        } catch (e) {
          expect(String(e)).toContain("ceiling invariant violated");
          stat(outcomes, "invariant-throw");
        }
      }),
      fcOpts(RUNS),
    );
    log({ bogusUpperSeed: outcomes });
  });

  test("generous budget closes from any valid seeds (upperSeed == truth included)", () => {
    fc.assert(
      fc.property(arbCase, arbSeeds, (spec, sd) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const { seed, upperSeed } = mkSeeds(c.truth.ceilings, sd);
        const r = withClock(new FakeClock(null), () => solveCeilings(input, seed, 1e12, { upperSeed }));
        if (input.slots.some((s) => s.length === 0) || buildQuery(spec).slots.length !== 5) return;
        const v = ceilingViolations({ ceilings: r.ceilings, ceilingUppers: r.uppers, ceilingsExact: r.exact }, c);
        const degenerate = r.uppers.every((u) => u === 200) && !r.exact && r.stats.probes === 0;
        if (!degenerate && !r.exact) v.push("generous solveCeilings not exact");
        fail(v, { input, seed, upperSeed });
      }),
      fcOpts(RUNS * 2),
    );
  });
});

describe("solve() seeding (ceilingSeed / ceilingUpperSeed / heapSeed)", () => {
  test("ceiling seeds under an adversarial clock stay honest", () => {
    fc.assert(
      fc.property(arbCase, arbSeeds, arbClockPlan, arbBudget, arbBudget, (spec, sd, plan, topN, ceil) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const { seed, upperSeed } = mkSeeds(c.truth.ceilings, sd);
        const { out } = adversarial(plan, () =>
          solve(input, { topNBudgetMs: topN, ceilingBudgetMs: ceil, ceilingSeed: seed, ceilingUpperSeed: upperSeed }),
        );
        fail([...ceilingViolations(out, c), ...buildViolations(input, out, c)], { input, seed, upperSeed, plan, topN, ceil });
      }),
      fcOpts(RUNS * 3),
    );
  });

  test("heapSeed = a capped run's builds ⇒ the re-run equals the cold run, no duplicates", () => {
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(arbCase, arbClockPlan, arbBudget, arbClockPlan, arbBudget, (spec, plan, topN, plan2, topN2) => {
        const input = buildQuery(spec);
        const c = prepare(input, spec.shape);
        const { out: first } = adversarial(plan, () => solve(input, { topNBudgetMs: topN, ceilingBudgetMs: 0 }));
        stat(m, first.capped ? "firstCapped" : "firstUncapped");
        // Generous re-run seeded with the first run's builds.
        const second = withClock(new FakeClock(null), () => solve(input, { ...GENEROUS, heapSeed: first.loadouts }));
        const v = [...ceilingViolations(second, c), ...buildViolations(input, second, c)];
        if (second.capped) v.push("generous seeded re-run capped");
        // And a time-pressed seeded re-run (the session's phase 2 shape).
        const { out: third } = adversarial(plan2, () =>
          solve(input, { topNBudgetMs: topN2, ceilingBudgetMs: 0, heapSeed: first.loadouts, ceilingSeed: first.ceilings }),
        );
        if (third.capped) stat(m, "thirdCapped");
        v.push(...ceilingViolations(third, c), ...buildViolations(input, third, c));
        // A seeded run can never return fewer builds than it was seeded with.
        if (third.loadouts.length < first.loadouts.length) v.push("seeded re-run lost builds");
        fail(v, { input, plan, topN, plan2, topN2 });
      }),
      fcOpts(RUNS * 3),
    );
    log({ heapSeed: m });
  });
});

describe("runSolveSession() under an adversarial clock", () => {
  test("every post is honest; the final post keeps the frozen list", () => {
    sessionProperty(arbCase, arbClockPlan, RUNS * 2, "session");
  });
  test("same, on long-leaf pools with timeouts aimed into the tuners (phase 2 capped)", () => {
    sessionProperty(
      arbQuerySpec(["tunerBig", "big"]),
      fc.record({
        incs: fc.constantFrom([0], [0, 0, 1]),
        jumps: fc.array(
          fc.record({
            frac: fc.integer({ min: 0, max: 1000 }).map((x) => x / 1000),
            by: fc.constant(1e7),
            site: fc.constantFrom<ClockSite>("topn-tuner", "probe-tuner", "topn-walk"),
          }),
          { minLength: 1, maxLength: 3 },
        ),
      }),
      RUNS,
      "sessionAimed",
    );
  });
});

function sessionProperty(arbSpec: fc.Arbitrary<QuerySpec>, arbPlan: fc.Arbitrary<ClockPlan>, runs: number, label: string): void {
  {
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(
        arbSpec,
        arbPlan,
        fc.record({
          topNBudgetMs: arbBudget,
          ceilingBudgetMs: arbBudget,
          refineCeilingBudgetMs: arbBudget,
          refineTopNBudgetMs: arbBudget,
        }),
        (spec, plan, budgets) => {
          const input = buildQuery(spec);
          const c = prepare(input, spec.shape);
          let posts: { out: OptimizerOutput; refining: boolean; verified: boolean }[] = [];
          let better: OptimizerOutput[] = [];
          const run = () => {
            posts = [];
            better = [];
            runSolveSession(
              input,
              {
                onProgress: () => {},
                onCeilings: () => {},
                onResult: (out, refining, verified) => posts.push({ out, refining, verified }),
                onBetter: (o) => better.push(o),
              },
              budgets,
            );
          };
          adversarial(plan, run);
          const v: string[] = [];
          const final = posts[posts.length - 1];
          if (!final || final.refining) v.push("no final post");
          stat(m, `posts:${posts.length}`);
          if (better.length) stat(m, "onBetter");
          if (posts.length > 1 && !final?.verified) stat(m, "finalUnverified");
          const coldTotals = c.cold.loadouts.map((l) => l.total).join();
          for (const p of posts) {
            v.push(...ceilingViolations(p.out, c).map((x) => `post: ${x}`));
            v.push(...buildViolations(input, p.out, c).map((x) => `post: ${x}`));
            // `verified` = "a build walk ran to exhaustion". With no better list offered,
            // the posted (frozen) list must then BE the exhaustive top-N; when a better
            // list was offered, that offer must be it.
            if (p.verified) {
              const shown = better.length ? better[better.length - 1] : p.out;
              if (shown.loadouts.map((l) => l.total).join() !== coldTotals)
                v.push(`verified post (better offered: ${better.length}) differs from cold`);
            }
          }
          for (const b of better) {
            v.push(...ceilingViolations(b, c).map((x) => `better: ${x}`));
            v.push(...buildViolations(input, b, c, false).map((x) => `better: ${x}`));
          }
          if (posts.length > 1 && posts[0].out.loadouts.map((l) => l.pieceIds.join()).join() !== final.out.loadouts.map((l) => l.pieceIds.join()).join())
            v.push("final post changed the frozen list");
          fail(v, { input, plan, budgets });
        },
      ),
      fcOpts(runs),
    );
    log({ [label]: m });
  }
}

// ---------------------------------------------------------------------------
// Targeted: timeouts aimed at the leaf tuner's onTick (mid-leaf), on pools whose leaves
// actually run long directional searches.
// ---------------------------------------------------------------------------

const arbTunerPlan: fc.Arbitrary<ClockPlan> = fc.record({
  incs: fc.constantFrom([0], [0, 0, 1], [1]),
  jumps: fc.array(
    fc.record({
      frac: fc.integer({ min: 0, max: 1000 }).map((x) => x / 1000),
      by: fc.constant(1e7),
      site: fc.constantFrom<ClockSite>("probe-tuner", "topn-tuner", "probe-walk"),
    }),
    { minLength: 1, maxLength: 2 },
  ),
});

describe("timeouts aimed inside the leaf tuner", () => {
  test("solve() and solveCeilings() stay honest when the deadline trips mid-leaf", () => {
    const sites: Record<string, number> = {};
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(
        arbQuerySpec(["tunerBig", "tunerBig", "big"]),
        arbTunerPlan,
        arbBudget,
        arbBudget,
        arbSeeds,
        (spec, plan, topN, ceil, sd) => {
          const input = buildQuery(spec);
          const c = prepare(input, spec.shape);
          const { out } = adversarial(plan, () => solve(input, { topNBudgetMs: topN, ceilingBudgetMs: ceil }), sites);
          stat(m, out.capped ? "capped" : "uncapped");
          const v = [...ceilingViolations(out, c), ...buildViolations(input, out, c)];
          const { seed, upperSeed } = mkSeeds(c.truth.ceilings, sd);
          const { out: r } = adversarial(plan, () => solveCeilings(input, seed, ceil, { upperSeed }), sites);
          if (r.stats.timedOut) stat(m, "probeTimedOut");
          v.push(...ceilingViolations({ ceilings: r.ceilings, ceilingUppers: r.uppers, ceilingsExact: r.exact }, c));
          fail(v, { input, plan, topN, ceil, seed, upperSeed });
        },
      ),
      fcOpts(RUNS * 2),
    );
    log({ tunerAimed: m, jumpSites: sites });
  });
});

// ---------------------------------------------------------------------------
// Seeding across queries: computeCeilingCarry(prev → next min edit) under time pressure.
// ---------------------------------------------------------------------------

describe("cross-edit ceiling carry under an adversarial clock", () => {
  test("carried seeds keep the next query's ceilings honest", () => {
    const m: Record<string, number> = {};
    fc.assert(
      fc.property(
        arbCase,
        fc.array(fc.integer({ min: -12, max: 12 }), { minLength: 6, maxLength: 6 }),
        fc.constantFrom("tighten", "loosen", "equal", "mixed"),
        arbClockPlan,
        arbBudget,
        arbClockPlan,
        arbBudget,
        (spec, edit, dir, plan1, b1, plan2, b2) => {
          const prevInput = buildQuery(spec);
          const nextMins = prevInput.minimums.map((v, s) => {
            const d = dir === "tighten" ? Math.abs(edit[s]) : dir === "loosen" ? -Math.abs(edit[s]) : dir === "equal" ? 0 : edit[s];
            return Math.max(0, Math.min(200, v + d));
          });
          const nextInput: OptimizerInput = { ...prevInput, minimums: nextMins };
          const { out: prev } = adversarial(plan1, () => solve(prevInput, { topNBudgetMs: b1, ceilingBudgetMs: b1 }));
          const carry = computeCeilingCarry(prevInput, prev, nextInput);
          stat(m, `${dir}:${carry ? Object.keys(carry).sort().join("+") || "empty" : "none"}`);
          const c = prepare(nextInput, spec.shape);
          const { out } = adversarial(plan2, () =>
            solve(nextInput, {
              topNBudgetMs: b2,
              ceilingBudgetMs: b2,
              ceilingSeed: carry?.ceilingSeed,
              ceilingUpperSeed: carry?.ceilingUpperSeed,
            }),
          );
          fail([...ceilingViolations(out, c), ...buildViolations(input2(nextInput), out, c)], {
            prevInput,
            nextMins,
            plan1,
            b1,
            plan2,
            b2,
            carry,
          });
        },
      ),
      fcOpts(RUNS * 2),
    );
    log({ carry: m });
  });
});
const input2 = (x: OptimizerInput) => x;

// ---------------------------------------------------------------------------
// Liveness of the onTick hook: a deadline that expires while ONE long leaf is being
// tuned must be noticed (documented: "a long leaf can't outrun its caller's deadline
// unnoticed"). Single-piece slots, so the walk itself never reaches a node check.
// ---------------------------------------------------------------------------

describe("the leaf tuner's onTick reaches the caller's deadline", () => {
  // Found by search over single-piece tunable pools (scratch, seed 11): its one leaf's
  // maximize-mode directional search visits ~48k tuner nodes (47 onTick calls).
  const longLeaf: OptimizerInput = {
    slots: [
      [{ id: "p0", stats: [30, 25, 20, 5, 5, 5], exotic: false, tuning: { tuned: 3, offStats: [3, 4, 5] } }],
      [{ id: "p1", stats: [5, 30, 5, 5, 20, 25], exotic: true, hash: 1000, tuning: { tuned: 2, offStats: [0, 2, 3] } }],
      [{ id: "p2", stats: [0, 10, 14, 4, 18, 1], exotic: false, tuning: { tuned: 0, offStats: [0, 3, 5] } }],
      [{ id: "p3", stats: [30, 5, 5, 25, 5, 20], exotic: false, tuning: { tuned: 1, offStats: [1, 2, 4] } }],
      [{ id: "p4", stats: [7, 19, 18, 29, 29, 4], exotic: false, tuning: { tuned: 5, offStats: [0, 2, 5] } }],
    ],
    minimums: [57, 72, 64, 71, 79, 61],
    mods: { major: 4, minor: 1 },
    fragmentBonus: [-20, -20, 0, 0, 0, 0],
    allowTuning: true,
    allowBalancedTuning: false,
    exotic: { mode: "any" },
    maxResults: 3,
  };
  const aimAt = (site: ClockSite): ClockPlan => ({ incs: [0], jumps: [{ frac: 0, by: 1e7, site }] });

  test("the long leaf's searches do tick (top-N and probes)", () => {
    const clock = new FakeClock(null);
    clock.siteHist = {};
    withClock(clock, () => solve(longLeaf, GENEROUS));
    expect(clock.siteHist["topn-tuner"] ?? 0).toBeGreaterThan(10);
    expect(clock.siteHist["probe-tuner"] ?? 0).toBeGreaterThan(0);
  });

  test("solve(): a top-N deadline expiring inside the leaf is noticed (capped)", () => {
    const sites: Record<string, number> = {};
    const { out } = adversarial(aimAt("topn-tuner"), () => solve(longLeaf, { topNBudgetMs: 5, ceilingBudgetMs: 0 }), sites);
    expect(sites["topn-tuner"]).toBe(1);
    expect(out.capped).toBe(true);
    // ...and the leaf it was tuning still finished honestly.
    const c = prepare(longLeaf, "tiny");
    fail([...ceilingViolations(out, c), ...buildViolations(longLeaf, out, c)], {});
  });

  test("solveCeilings(): a probe deadline expiring inside the leaf counts as timed out", () => {
    const sites: Record<string, number> = {};
    const { out: r } = adversarial(aimAt("probe-tuner"), () => solveCeilings(longLeaf, [0, 0, 0, 0, 0, 0], 50), sites);
    expect(sites["probe-tuner"]).toBe(1);
    expect(r.stats.timedOut).toBeGreaterThan(0);
    const c = prepare(longLeaf, "tiny");
    fail(ceilingViolations({ ceilings: r.ceilings, ceilingUppers: r.uppers, ceilingsExact: r.exact }, c), {});
  });
});

describe("QUESTION: infeasible queries do not yield all-zero ceilings", () => {
  // runCeilings' doc says "An infeasible query (no build meets the minimums) yields
  // zeros", but probes below a stat's own (unreachable) minimum still find that stat's
  // true max subject to the other five — which matches the oracle's definition and is
  // what this suite checks. Pinned so a change to either the code or the doc is visible.
  test("one unreachable target: its ceiling is the true max, certified exact", () => {
    const p = (id: string) => ({ id, stats: [30, 25, 20, 5, 5, 5], exotic: false });
    const input: OptimizerInput = {
      slots: [0, 1, 2, 3, 4].map((k) => [p(`s${k}`)]),
      minimums: [151, 0, 0, 0, 0, 0],
      mods: { major: 0, minor: 0 },
      allowTuning: false,
    };
    const out = withClock(new FakeClock(null), () => solve(input, GENEROUS));
    expect(out.loadouts).toHaveLength(0);
    expect(out.ceilings).toEqual([150, 0, 0, 0, 0, 0]);
    expect(out.ceilingsExact).toBe(true);
    expect(oracle(input).ceilings).toEqual([150, 0, 0, 0, 0, 0]);
  });
});
