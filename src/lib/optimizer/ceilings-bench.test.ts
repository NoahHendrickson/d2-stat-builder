/**
 * Ceiling-refinement benchmark — gated behind BENCH so `npm test` stays fast and green.
 * Run with: BENCH=1 npx vitest run src/lib/optimizer/ceilings-bench.test.ts
 *
 * Purpose: give each later speedup step (subset-mask bound, witness harvest, bound
 * carryover) a measured baseline to beat, instead of vibes. For each scenario below we
 * solve for a seed (the same seed production would hand to solveCeilings), then run
 * solveCeilings to exact under a 120s budget, and separately measure what a
 * production-shaped 1200ms budget (CEILING_BUDGET_MS, see solve.ts) settles.
 *
 * BASELINE (captured 2026-07-03, Node vitest, this machine, uncached JIT — single run,
 * not averaged; later steps should re-run this same file for a fair before/after):
 *
 * Scenario: realWarlockTwoSetInput (180/0/0/105/0/0, exotic require, two 2pc sets)
 *   seed:            [180, 38, 85, 125, 110, 71]
 *   time to exact:   22139 ms
 *   stats:           { probes: 37, feasible: 19, disproven: 18, timedOut: 0, nodes: 143011403 }
 *   exact ceilings:  [200, 55, 115, 145, 125, 105]
 *   at 1200ms:       ceilings [200, 53, 95, 140, 110, 75], exact=false,
 *                    stats { probes: 37, feasible: 15, disproven: 2, timedOut: 20, nodes: 8175617 }
 *
 * Scenario: realWarlockCodaInput (190/0/0/120/0/0, CODA 4pc, mods 3/2, frag [0,0,10,-20,0,0])
 *   seed:            [190, 41, 96, 120, 71, 71]
 *   time to exact:   1442 ms
 *   stats:           { probes: 38, feasible: 16, disproven: 22, timedOut: 0, nodes: 9660887 }
 *   exact ceilings:  [200, 60, 120, 130, 95, 95]
 *   at 1200ms:       ceilings [200, 60, 120, 130, 95, 95], exact=false (all values found,
 *                    6 probes still timing out unproven),
 *                    stats { probes: 38, feasible: 16, disproven: 16, timedOut: 6, nodes: 8114177 }
 *
 * Takeaway: the two-set scenario (joint weapon+grenade minimums, small pool after the
 * exotic filter) is the expensive one — proving exactness costs 22s and 143M DFS nodes,
 * and at the production inline budget 20 of 37 probes time out having proven nothing.
 * The CODA scenario finds every final value within 1200ms but still can't PROVE them
 * inside the budget (6 timed-out probes) — exactness proofs, not discovery, are the
 * bottleneck in both.
 *
 * After Step 1 (subset-mask bound) — captured 2026-07-03, same machine, single run:
 *
 * Scenario: realWarlockTwoSetInput (180/0/0/105/0/0, exotic require, two 2pc sets)
 *   seed:            [180, 38, 85, 125, 110, 71]
 *   time to exact:   9216 ms
 *   stats:           { probes: 37, feasible: 19, disproven: 18, timedOut: 0, nodes: 63326456 }
 *   exact ceilings:  [200, 55, 115, 145, 125, 105]   (identical to baseline — no drift)
 *   at 1200ms:       ceilings [200, 55, 109, 144, 123, 84], exact=false,
 *                    stats { probes: 36, feasible: 14, disproven: 8, timedOut: 14, nodes: 8408068 }
 *
 * Scenario: realWarlockCodaInput (190/0/0/120/0/0, CODA 4pc, mods 3/2, frag [0,0,10,-20,0,0])
 *   seed:            [190, 41, 96, 120, 71, 71]
 *   time to exact:   116 ms
 *   stats:           { probes: 38, feasible: 16, disproven: 22, timedOut: 0, nodes: 743733 }
 *   exact ceilings:  [200, 60, 120, 130, 95, 95]   (identical to baseline — no drift)
 *   at 1200ms:       ceilings [200, 60, 120, 130, 95, 95], exact=TRUE at 114ms —
 *                    the production inline budget now PROVES this scenario,
 *                    stats { probes: 38, feasible: 16, disproven: 22, timedOut: 0, nodes: 743733 }
 *
 * Step 1 takeaway: CODA collapsed 1442ms/9.66M nodes → 116ms/744k (~12x) and is now
 * exact INSIDE the inline budget. Two-set improved 22.1s/143M → 9.2s/63M (~2.4x) —
 * real but not a collapse: its remaining cost sits in probes whose infeasibility isn't
 * a two-stat conservation argument (the mask fires at the root or not at all there),
 * which is what witness harvest / bound carryover (Steps 2–3) target. Exact ceilings
 * are bit-identical to baseline in both scenarios, as an admissible tightening must be.
 *
 * After Step 2 (witness harvest) — captured 2026-07-03, same machine, single run:
 *
 * Scenario: realWarlockTwoSetInput (180/0/0/105/0/0, exotic require, two 2pc sets)
 *   seed:            [180, 38, 85, 125, 110, 71]
 *   time to exact:   8593 ms
 *   stats:           { probes: 30, feasible: 11, disproven: 19, timedOut: 0, nodes: 61852167 }
 *   exact ceilings:  [200, 55, 115, 145, 125, 105]   (bit-identical to Step 1 / baseline)
 *   at 1200ms:       ceilings [200, 55, 110, 145, 125, 90], exact=false,
 *                    stats { probes: 31, feasible: 10, disproven: 9, timedOut: 12, nodes: 8630273 }
 *
 * Scenario: realWarlockCodaInput (190/0/0/120/0/0, CODA 4pc, mods 3/2, frag [0,0,10,-20,0,0])
 *   seed:            [190, 41, 96, 120, 71, 71]
 *   time to exact:   99 ms
 *   stats:           { probes: 29, feasible: 9, disproven: 20, timedOut: 0, nodes: 664374 }
 *   exact ceilings:  [200, 60, 120, 130, 95, 95]   (bit-identical to Step 1 / baseline)
 *   at 1200ms:       ceilings [200, 60, 120, 130, 95, 95], exact=TRUE at 98ms,
 *                    stats { probes: 29, feasible: 9, disproven: 20, timedOut: 0, nodes: 664374 }
 *
 * Step 2 takeaway: harvest removes redundant probes by proving several stats' ceilings
 * from ONE feasible probe's witness build — the coupled stat never probes. Two-set
 * to-exact 37→30 probes (feasible 19→11: the eliminated 8 are exactly the probes a
 * discarded witness had already demonstrated), 9.2s→8.6s, 63.3M→61.9M nodes. CODA
 * 38→29 probes (feasible 16→9), 116→99ms. Modest wall-clock wins here because the
 * survivors are the EXPENSIVE disproof probes (harvest can't shortcut an impossibility
 * proof — only rediscovery), which is what bound carryover (Step 3) targets. Exact
 * ceilings bit-identical to Step 1 in both scenarios — harvest only raises the proven
 * low side, never the optimistic bound, so it cannot over- or under-report a maximum.
 *
 * After Step 3 (bound provenance) — captured 2026-07-03, same machine, single run.
 * NEW: three to-exact variants isolate what the upperSeed carryover alone buys.
 * Production's background phase 1 ALREADY seeds with the inline pass's ceilings
 * (session.ts passes them as the achievable seed) — so (b), not (a), is the pre-Step-3
 * background baseline, and the (b) vs (c) delta is Step 3's true production effect:
 *   (a) cold top-N seed        — the historical to-exact number (comparable to Steps 1–2);
 *   (b) inline-ceilings seed   — status-quo background-after-inline (no upperSeed);
 *   (c) inline ceilings+uppers — Step 3's background-after-inline.
 *
 * Scenario: realWarlockTwoSetInput (180/0/0/105/0/0, exotic require, two 2pc sets)
 *   seed:            [180, 38, 85, 125, 110, 71]
 *   at 1200ms:       ceilings [200, 55, 105, 145, 125, 90], uppers [200,135,132,145,154,125],
 *                    exact=false,
 *                    stats { probes: 31, feasible: 11, disproven: 8, timedOut: 12, nodes: 7849985 }
 *   (a) cold:        9533 ms,
 *                    stats { probes: 30, feasible: 11, disproven: 19, timedOut: 0, nodes: 61852167 }
 *   (b) status quo:  15623 ms,
 *                    stats { probes: 28, feasible: 3, disproven: 25, timedOut: 0, nodes: 108993125 }
 *   (c) Step 3:      14921 ms,
 *                    stats { probes: 18, feasible: 3, disproven: 15, timedOut: 0, nodes: 105341290 }
 *   exact ceilings:  [200, 55, 115, 145, 125, 105]   (bit-identical across a/b/c and Steps 1–2)
 *
 * Scenario: realWarlockCodaInput (190/0/0/120/0/0, CODA 4pc, mods 3/2, frag [0,0,10,-20,0,0])
 *   seed:            [190, 41, 96, 120, 71, 71]
 *   at 1200ms:       ceilings [200, 60, 120, 130, 95, 95], uppers identical, exact=TRUE at 106ms,
 *                    stats { probes: 29, feasible: 9, disproven: 20, timedOut: 0, nodes: 664374 }
 *   (a) cold:        104 ms,
 *                    stats { probes: 29, feasible: 9, disproven: 20, timedOut: 0, nodes: 664374 }
 *   (b) status quo:  87 ms — every value already at its ceiling, yet all 30 probes are
 *                    DISPROOFS re-run purely to re-close the upper windows,
 *                    stats { probes: 30, feasible: 0, disproven: 30, timedOut: 0, nodes: 512526 }
 *   (c) Step 3:      1 ms, ZERO probes — the carried uppers==ceilings settle every stat,
 *                    stats { probes: 0, feasible: 0, disproven: 0, timedOut: 0, nodes: 0 }
 *   exact ceilings:  [200, 60, 120, 130, 95, 95]   (bit-identical across a/b/c and Steps 1–2)
 *
 * Step 3 takeaway ((b) vs (c) is the production effect): the carryover eliminates exactly
 * the re-proof probes. CODA: 30 probes/87ms → 0 probes/1ms — the whole status-quo
 * background pass was redundant re-proving, and Step 3 deletes it. Two-set: probes 28→18
 * and disproven 25→15 (the 10 skipped are re-proofs of shrinks the inline pass certified),
 * nodes 109M→105M, 15.6s→14.9s (~5%) — modest wall-clock because the skipped disproofs are
 * the CHEAP low-`mid` ones; the surviving high-`mid` disproofs dominate cost. Note (b) vs
 * (a): seeding ceilings alone makes the two-set background SLOWER than cold (15.6s vs
 * 9.5s, 109M vs 62M nodes) — a pre-existing status-quo property (higher starting ceilings
 * push every probe into the expensive tight-window regime), NOT a Step 3 regression;
 * Step 3 strictly improves on (b) in both scenarios. Exact ceilings stay bit-identical
 * across all variants and Steps 1–2 — uppers only ever shrink on a PROVEN infeasible
 * probe, so the reported maxima can't drift.
 */
import { test } from "vitest";
import { solve, solveCeilings } from "./solve";
import { realWarlockCodaInput, realWarlockTwoSetInput } from "./real-pool.fixture";
import type { OptimizerInput } from "./types";

const bench = process.env.BENCH ? test : test.skip;

/** Production's inline ceiling budget (see CEILING_BUDGET_MS in solve.ts) — kept in
 * sync manually since it's not exported; used to report what settles in-line. */
const INLINE_BUDGET_MS = 1200;
const EXACT_BUDGET_MS = 120_000;

function runScenario(name: string, input: OptimizerInput) {
  // Same seed production hands to solveCeilings: an uncapped in-line solve with a
  // near-zero ceiling budget, so `first.ceilings` is just the top-N-derived seed.
  const first = solve(input, { ceilingBudgetMs: 0 });

  const inlineStart = performance.now();
  const inline = solveCeilings(input, first.ceilings, INLINE_BUDGET_MS);
  const inlineElapsed = performance.now() - inlineStart;

  const exactStart = performance.now();
  const exact = solveCeilings(input, first.ceilings, EXACT_BUDGET_MS);
  const exactElapsed = performance.now() - exactStart;

  // (b) Background-after-inline, STATUS QUO shape: production's phase 1 already seeds
  // with the inline pass's ceilings (session.ts passes first.ceilings as the achievable
  // seed) — so THIS, not the cold run (a), is the pre-Step-3 background baseline.
  const statusQuoStart = performance.now();
  const statusQuo = solveCeilings(input, inline.ceilings, EXACT_BUDGET_MS);
  const statusQuoElapsed = performance.now() - statusQuoStart;

  // (c) Step 3's background: same as (b) plus the inline run's proven uppers. The
  // (b) vs (c) delta is what the upperSeed carryover alone buys in production — the
  // background pass should not re-prove the infeasibility shrinks the inline pass
  // already certified.
  const seededStart = performance.now();
  const seeded = solveCeilings(input, inline.ceilings, EXACT_BUDGET_MS, {
    upperSeed: inline.uppers,
  });
  const seededElapsed = performance.now() - seededStart;

  console.log(`\n[bench] ${name}`);
  console.log(`  seed:            ${JSON.stringify(first.ceilings)}`);
  console.log(`  at ${INLINE_BUDGET_MS}ms: elapsed=${inlineElapsed.toFixed(0)}ms`, {
    ceilings: inline.ceilings,
    uppers: inline.uppers,
    exact: inline.exact,
    stats: inline.stats,
  });
  console.log(`  (a) to exact, cold top-N seed: elapsed=${exactElapsed.toFixed(0)}ms`, {
    ceilings: exact.ceilings,
    exact: exact.exact,
    stats: exact.stats,
  });
  console.log(
    `  (b) inline-ceilings seed only (status-quo background): elapsed=${statusQuoElapsed.toFixed(0)}ms`,
    { ceilings: statusQuo.ceilings, exact: statusQuo.exact, stats: statusQuo.stats },
  );
  console.log(
    `  (c) inline ceilings + uppers (Step 3 background): elapsed=${seededElapsed.toFixed(0)}ms`,
    { ceilings: seeded.ceilings, exact: seeded.exact, stats: seeded.stats },
  );
}

bench(
  "realWarlockTwoSetInput",
  () => {
    runScenario("realWarlockTwoSetInput", realWarlockTwoSetInput());
  },
  300_000,
);

bench(
  "realWarlockCodaInput",
  () => {
    runScenario("realWarlockCodaInput", realWarlockCodaInput());
  },
  300_000,
);
