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

  console.log(`\n[bench] ${name}`);
  console.log(`  seed:            ${JSON.stringify(first.ceilings)}`);
  console.log(`  at ${INLINE_BUDGET_MS}ms: elapsed=${inlineElapsed.toFixed(0)}ms`, {
    ceilings: inline.ceilings,
    exact: inline.exact,
    stats: inline.stats,
  });
  console.log(`  to exact:        elapsed=${exactElapsed.toFixed(0)}ms`, {
    ceilings: exact.ceilings,
    exact: exact.exact,
    stats: exact.stats,
  });
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
