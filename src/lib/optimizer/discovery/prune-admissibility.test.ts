/**
 * Discovery: admissibility of every prefix prune in solve.ts recurse() and ceilings.ts
 * search() under sets / exotic modes / power ranges / buildSlots pools. See
 * prune-harness.ts for what each check means.
 */
import { describe, expect, test, vi } from "vitest";
import { mulberry32 } from "../test-rng";
import { solve } from "../solve";
import { NUM_STATS } from "../floors";
import {
  auditPrunes,
  dedupedTotals,
  emptyCoverage,
  exoticLegal,
  genInput,
  genProbeMins,
  powerInRange,
  rawTruth,
  setsMet,
  type GenOptions,
  type Violation,
} from "./prune-harness";

// 3000 (~10 s) is what the mutation run needed to catch the rarest killed mutant
// (fragmentCredit's `>= 0` edge); PROP_RUNS=20000 for a deep run.
const RUNS = Number(process.env.PROP_RUNS ?? 3000);
const SEED = Number(process.env.PROP_SEED ?? 0x9e3779b9);
const VERBOSE = !!process.env.PROP_VERBOSE;
/** Raw-combo cap per generated pool (1 = single-leaf pools: many more cases per second). */
const MAX_COMBOS = Number(process.env.PROP_MAXCOMBOS ?? 1000);

describe("prefix prunes are admissible (sets, exotics, power, buildSlots pools)", () => {
  test(`${RUNS} seeded-random inputs: every prune's claim holds against brute force`, () => {
    const cov = emptyCoverage();
    const fired: Record<string, number> = {};
    const byKind: Record<string, { n: number; first: string }> = {};
    let tight = 0;
    let nodes = 0;
    for (let iter = 0; iter < RUNS; iter++) {
      const caseSeed = (SEED + iter * 0x632be5ab) >>> 0;
      const rng = mulberry32(caseSeed);
      const input = genInput(rng, cov, { maxCombos: MAX_COMBOS });
      const probes = genProbeMins(rng, input, 3);
      const { violations, stats } = auditPrunes(input, { probeMins: probes });
      nodes += stats.nodes;
      tight += stats.admissionTight;
      for (const [k, v] of Object.entries(stats.fired)) fired[k] = (fired[k] ?? 0) + v;
      for (const v of violations) {
        const key = `${v.kind}${v.legal ? "" : " (illegal-only)"}`;
        if (!byKind[key]) byKind[key] = { n: 0, first: `seed=${caseSeed} k=${v.k} prefix=${v.prefix} ${v.detail}` };
        byKind[key].n++;
      }
    }
    if (VERBOSE) {
      process.stderr.write("\n" + JSON.stringify({ cov, fired, tight, nodes }, null, 1));
      process.stderr.write("\n" + JSON.stringify(byKind, null, 1));
    }
    // Every prune must have actually fired somewhere, or its check is vacuous.
    for (const k of ["canReachMin", "canReachMin-probe", "canReachSets", "exoticSuffix", "nextExoticCount", "powerPrefix"]) {
      expect(fired[k] ?? 0, `prune ${k} never fired`).toBeGreaterThan(20);
    }
    expect(tight).toBeGreaterThan(0);
    expect(byKind).toEqual({});
  }, 600_000);
});

/** Every returned loadout legal under the constraints this file targets. */
function legalOut(input: Parameters<typeof solve>[0], ids: string[]) {
  const pieces = ids.map((id, k) => input.slots[k].find((p) => p.id === id)!);
  return exoticLegal(pieces, input) && setsMet(pieces, input.setRequirements ?? []) && powerInRange(pieces, input.powerRange);
}

interface E2EResult {
  issues: Record<string, { n: number; first: string }>;
  feasibleCases: number;
  boundPruned: number;
}

/**
 * solve() vs brute force over the raw pool. Runs with NODE_ENV=production so the
 * ceiling-invariant guard logs (recorded as "invariant-violated") instead of throwing —
 * F1 used to trip it — and the remaining checks still run on that input.
 */
function endToEnd(runs: number, seedBase: number, gopts: GenOptions): E2EResult {
  const issues: Record<string, { n: number; first: string }> = {};
  const note = (k: string, msg: string) => {
    if (!issues[k]) issues[k] = { n: 0, first: msg };
    issues[k].n++;
  };
  let feasibleCases = 0;
  let boundPruned = 0;
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NODE_ENV", "production");
  try {
    for (let iter = 0; iter < runs; iter++) {
      const caseSeed = (seedBase + iter * 0x2545f491) >>> 0;
      const input = genInput(mulberry32(caseSeed), undefined, gopts);
      errSpy.mockClear();
      const out = solve(input, { topNBudgetMs: 60_000, ceilingBudgetMs: 60_000 });
      if (errSpy.mock.calls.length) note("invariant-violated", `seed=${caseSeed} ${errSpy.mock.calls[0][0]}`);
      const raw = rawTruth(input);
      const dd = dedupedTotals(input);
      const ctx = `seed=${caseSeed}`;
      if (out.capped) note("capped", ctx);
      if ((out.loadouts.length > 0) !== raw.feasible) note("feasibility", `${ctx} solve=${out.loadouts.length} raw=${raw.feasible}`);
      if ((dd.length > 0) !== raw.feasible) note("dedupe-feasibility", `${ctx} dedup=${dd.length} raw=${raw.feasible}`);
      if (dd.length && raw.totals.length && dd[0] !== raw.totals[0]) note("dedupe-best", `${ctx} dedup=${dd[0]} raw=${raw.totals[0]}`);
      const n = input.maxResults ?? 200;
      const want = dd.slice(0, n);
      const got = out.loadouts.map((l) => l.total);
      if (JSON.stringify(want) !== JSON.stringify(got)) note("topN", `${ctx} want=${want} got=${got}`);
      for (const lo of out.loadouts) if (!legalOut(input, lo.pieceIds)) note("illegal-loadout", `${ctx} ${lo.pieceIds}`);
      if (raw.feasible) feasibleCases++;
      if (!out.combosValidExact) boundPruned++;
      for (let s = 0; s < NUM_STATS; s++) {
        if (out.ceilings[s] > raw.ceilings[s]) note("ceiling-over", `${ctx} s=${s} got=${out.ceilings[s]} truth=${raw.ceilings[s]}`);
        if (out.ceilingUppers[s] < raw.ceilings[s]) note("upper-under", `${ctx} s=${s} upper=${out.ceilingUppers[s]} truth=${raw.ceilings[s]}`);
      }
      if (out.ceilingsExact && JSON.stringify(out.ceilings) !== JSON.stringify(raw.ceilings)) {
        note("ceiling-exact-mismatch", `${ctx} got=${out.ceilings} truth=${raw.ceilings}`);
      }
    }
  } finally {
    vi.unstubAllEnvs();
    errSpy.mockRestore();
  }
  return { issues, feasibleCases, boundPruned };
}

describe("end-to-end: pruning is invisible", () => {
  const E2E_RUNS = Math.ceil(RUNS / 2);
  // Before F1 (floors.ts, 153701d) this run reported "ceiling-over" / "ceiling-exact-
  // mismatch" / "invariant-violated"; before F3 (dedupe key, 0221eea) "dedupe-best",
  // "upper-under" and "ceiling-exact-mismatch" on Balanced-only exotic twins. Both fixes
  // are on this branch, so every check is enforced.
  test(`${E2E_RUNS} inputs: top-N totals, feasibility, legality, ceilings vs brute force`, () => {
    const r = endToEnd(E2E_RUNS, SEED ^ 0xabcdef, {});
    if (VERBOSE) process.stderr.write("\n" + JSON.stringify(r, null, 1));
    expect(r.feasibleCases).toBeGreaterThan(E2E_RUNS / 10);
    expect(r.boundPruned).toBeGreaterThan(E2E_RUNS / 10);
    expect(r.issues).toEqual({});
  }, 600_000);
});

export type { Violation };
