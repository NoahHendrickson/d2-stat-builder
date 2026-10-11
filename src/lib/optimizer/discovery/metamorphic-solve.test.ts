/**
 * Metamorphic relations of the full solve() — policy-independent ones only.
 *
 * Every relation compares two solver runs. Totals/feasibility are compared only when both
 * runs are uncapped (exhaustive top-N); ceilings are compared exactly only when both are
 * proven exact, otherwise only their proven brackets [ceilings, ceilingUppers] must agree.
 *
 * What the ranking policy fixes (Balanced first, mods only cover targets, majors-first
 * covering): a loadout's ranking total is a function of the loadout and the query alone,
 * never of the rest of the pool or the walk order. That is what makes these relations
 * policy-independent: the uncapped top-N is the top-N of a fixed multiset of per-combo
 * totals, so pool order / duplicates / slot order cannot change it, adding pieces only adds
 * combos, and maxResults only truncates. Relations that move a combo's OWN total (raising a
 * minimum, changing the mod budget) are not asserted on totals — only on feasibility and
 * ceilings, which are monotone by definition.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { NUM_SLOTS, NUM_STATS } from "../floors";
import { solve } from "../solve";
import type { OptimizerInput, OptimizerPiece } from "../types";
import {
  NUM_RUNS,
  clone,
  expectBracketsOverlap,
  expectCeilingsDominate,
  expectSameResults,
  expectTotalsDominate,
  newCoverage,
  noteCoverage,
  permuteSlots,
  queryArb,
  realSubsampleArb,
  relabelStats,
  reorderWithinSlots,
  GENEROUS,
  boundaryArb,
  checkLoadout,
  bruteCeilings,
  bruteTopTotals,
  clampFree,
  run,
  show,
  type Coverage,
} from "./metamorphic-gen";

const SMALL = queryArb({ minPer: 1, maxPer: 3 });
const MID = queryArb({ minPer: 3, maxPer: 7 });
const LARGE = queryArb({ minPer: 6, maxPer: 12 });
const REAL = realSubsampleArb(4, 9);
/** Mixed sizes: mostly mid, some tiny, some large, some real-pool subsamples. */
const PLAIN = fc.oneof(
  { arbitrary: SMALL, weight: 2 },
  { arbitrary: MID, weight: 4 },
  { arbitrary: LARGE, weight: 2 },
  { arbitrary: REAL, weight: 1 },
);
/** Half plain queries, half pushed onto their feasibility boundary (boundaryArb). */
const ANY = fc.oneof(PLAIN, boundaryArb(PLAIN));
/** Clamp-free pools (Tier-5 rolls, fragments ≥ 0) where totals must be slot-order free. */
const CLEAN = queryArb({ minPer: 2, maxPer: 8, clean: true });
/** …and with an unambiguous mod budget and no artifice, where totals must be stat-order free. */
const CLEAN_UNAMBIG = queryArb({ minPer: 2, maxPer: 8, clean: true, unambiguousMods: true, artificeRate: 0 });

const permArb = fc.shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 6, maxLength: 6 });
const slotPermArb = fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 });

const report = (name: string, c: Coverage): void => {
  console.log(`[coverage] ${name}: ${JSON.stringify(c)}`);
};

const PARAMS = (runs: number) => ({ numRuns: NUM_RUNS(runs), endOnFailure: false });

describe("metamorphic: pool shape invariance", () => {
  test("reordering pieces within each slot changes nothing", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.array(fc.nat(20), { minLength: 5, maxLength: 5 }), (input, keys) => {
        const a = run(input);
        const b = run(reorderWithinSlots(input, keys));
        if (!noteCoverage(cov, input, a, b)) return;
        expectSameResults(a, b, "reorder");
      }),
      PARAMS(120),
    );
    report("reorder", cov);
  }, 120_000);

  test("duplicating a piece under a new id changes nothing", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.nat(), fc.nat(), fc.nat(), (input, k0, i0, pos0) => {
        const k = k0 % NUM_SLOTS;
        const slot = input.slots[k];
        const dup = { ...slot[i0 % slot.length], id: "dup" };
        const b = clone(input);
        b.slots[k].splice(pos0 % (slot.length + 1), 0, dup);
        const ra = run(input);
        const rb = run(b);
        if (!noteCoverage(cov, input, ra, rb)) return;
        expectSameResults(ra, rb, "duplicate");
      }),
      PARAMS(120),
    );
    report("duplicate", cov);
  }, 120_000);

  /**
   * Feasibility, list length and ceilings must not depend on slot order. TOTALS do on
   * pools where a −5 can be absorbed by the 0-clamp (FINDING T1, metamorphic-tuner.test.ts
   * / findings.test.ts), so totals are compared only on clamp-free pools here.
   */
  test("permuting the five slots changes nothing (totals: clamp-free pools)", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(fc.oneof(ANY, CLEAN, boundaryArb(CLEAN)), slotPermArb, (input, perm) => {
        const a = run(input);
        const b = run(permuteSlots(input, perm));
        if (!noteCoverage(cov, input, a, b)) return;
        const ctx = `slot perm ${perm}`;
        expect(b.feasible, `${ctx}: feasibility`).toBe(a.feasible);
        expect(b.totals.length, `${ctx}: list length`).toBe(a.totals.length);
        if (a.exact && b.exact) expect(b.out.ceilings, `${ctx}: ceilings`).toEqual(a.out.ceilings);
        else expectBracketsOverlap(a, b, ctx);
        if (clampFree(input)) {
          cov.clampFree = (cov.clampFree ?? 0) + 1;
          expect(b.totals, `${ctx}: totals`).toEqual(a.totals);
        }
      }),
      PARAMS(100),
    );
    report("slot perm", cov);
  }, 120_000);

  /**
   * Feasibility, list length and (permuted) ceilings must survive relabeling. TOTALS
   * depend on stat order through assignMods' first-found covering when the budget mixes
   * majors and minors (or artifice) — QUESTION Q2 — so totals are compared only on
   * clamp-free pools with a single mod size and no artifice.
   */
  test("relabeling the six stats permutes ceilings and keeps feasibility", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(fc.oneof(ANY, CLEAN_UNAMBIG, boundaryArb(CLEAN_UNAMBIG)), permArb, (input, perm) => {
        const a = run(input);
        const b = run(relabelStats(input, perm));
        if (!noteCoverage(cov, input, a, b)) return;
        expect(b.feasible, "feasibility").toBe(a.feasible);
        expect(b.totals.length, "list length").toBe(a.totals.length);
        if (a.exact && b.exact) {
          const want = new Array(NUM_STATS).fill(0);
          for (let s = 0; s < NUM_STATS; s++) want[perm[s]] = a.out.ceilings[s];
          expect(b.out.ceilings, "ceilings").toEqual(want);
        } else {
          expectBracketsOverlap(a, b, "relabel", perm);
        }
        const m = input.mods ?? { major: 0, minor: 0 };
        const unambiguous =
          (m.major === 0 || m.minor === 0) && !input.slots.some((s) => s.some((p) => p.artifice));
        if (unambiguous && clampFree(input)) {
          cov.totalsCompared = (cov.totalsCompared ?? 0) + 1;
          expect(b.totals, `relabel ${perm}: totals`).toEqual(a.totals);
        }
      }),
      PARAMS(100),
    );
    report("stat relabel", cov);
  }, 120_000);
});

describe("differential: uncapped top-N = top-N of every combo's tuner total", () => {
  test("the walk's pruning (admission bound, joint-min, sets, power, exotics) is invisible", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, (input) => {
        const want = bruteTopTotals(input, input.maxResults ?? 200);
        fc.pre(want !== null);
        const a = run(input);
        if (!noteCoverage(cov, input, a)) return;
        expect(a.totals, `top-N vs brute force: ${show({ ...input, slots: input.slots.map((s) => s.length) })}`).toEqual(want);
      }),
      PARAMS(120),
    );
    report("brute top-N", cov);
  }, 300_000);

  test("exact ceilings = per-stat max over every combo's tuner feasibility", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, (input) => {
        const want = bruteCeilings(input);
        fc.pre(want !== null);
        const a = run(input);
        if (!noteCoverage(cov, input, a)) return;
        const ctx = `ceilings vs brute force: ${show({ ...input, slots: input.slots.map((s) => s.length) })}`;
        for (let s = 0; s < NUM_STATS; s++) {
          expect(a.out.ceilings[s], `${ctx} (achievable ${s})`).toBeLessThanOrEqual(want![s]);
          expect(a.out.ceilingUppers[s], `${ctx} (upper ${s})`).toBeGreaterThanOrEqual(want![s]);
        }
        if (a.exact) expect(a.out.ceilings, ctx).toEqual(want);
      }),
      PARAMS(100),
    );
    report("brute ceilings", cov);
  }, 300_000);
});

describe("metamorphic: seeded re-solves equal the cold solve", () => {
  test("heapSeed / ceilingSeed / ceilingUpperSeed from the same query change nothing", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.integer({ min: 0, max: 7 }), (input, which) => {
        const a = run(input);
        if (!noteCoverage(cov, input, a)) return;
        const opts = {
          ...GENEROUS,
          heapSeed: which & 1 ? a.out.loadouts : undefined,
          ceilingSeed: which & 2 ? a.out.ceilings : undefined,
          ceilingUpperSeed: which & 4 ? a.out.ceilingUppers : undefined,
        };
        const out = solve(input, opts);
        expect(out.capped).toBe(false);
        expect(out.loadouts.map((l) => l.total), `seeded ${which}`).toEqual(a.totals);
        if (a.exact) {
          expect(out.ceilings, `seeded ${which}`).toEqual(a.out.ceilings);
          expect(out.ceilingsExact).toBe(true);
        }
      }),
      PARAMS(100),
    );
    report("seeded", cov);
  }, 120_000);
});

describe("metamorphic: monotone pool / query edits", () => {
  // A fresh piece drawn from the same generator (one-piece slot of a generated query).
  const freshPiece = queryArb({ minPer: 1, maxPer: 1, exoticRate: 0.3 }).map((q) => q.slots[0][0]);

  test("adding a piece can only help: feasibility, k-th best totals, ceilings", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, freshPiece, fc.nat(), fc.nat(), (input, piece, k0, pos0) => {
        const k = k0 % NUM_SLOTS;
        const b = clone(input);
        b.slots[k].splice(pos0 % (b.slots[k].length + 1), 0, { ...piece, id: "new" });
        const ra = run(input);
        const rb = run(b);
        if (!noteCoverage(cov, input, ra, rb)) return;
        if (ra.feasible) expect(rb.feasible, "feasibility lost by adding a piece").toBe(true);
        expectTotalsDominate(ra, rb, `add ${show(piece)} to slot ${k}`);
        expectCeilingsDominate(ra, rb, `add ${show(piece)} to slot ${k}`);
      }),
      PARAMS(100),
    );
    report("add piece", cov);
  }, 180_000);

  test("removing a piece can only hurt", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.nat(), fc.nat(), (input, k0, i0) => {
        const k = k0 % NUM_SLOTS;
        fc.pre(input.slots[k].length > 1);
        const b = clone(input);
        b.slots[k].splice(i0 % b.slots[k].length, 1);
        const ra = run(input);
        const rb = run(b);
        if (!noteCoverage(cov, input, ra, rb)) return;
        if (rb.feasible) expect(ra.feasible).toBe(true);
        expectTotalsDominate(rb, ra, `remove from slot ${k}`);
        expectCeilingsDominate(rb, ra, `remove from slot ${k}`);
      }),
      PARAMS(120),
    );
    report("remove piece", cov);
  }, 180_000);

  type Edit = { kind: "lowerMin" | "mods" | "artifice" | "frag"; a: number; b: number; amt: number };
  const editArb: fc.Arbitrary<Edit> = fc.record({
    kind: fc.constantFrom("lowerMin" as const, "mods" as const, "artifice" as const, "frag" as const),
    a: fc.nat(),
    b: fc.nat(),
    amt: fc.integer({ min: 1, max: 40 }),
  });
  /** A relaxing edit: lower a minimum, more mods, artifice on a piece, a bigger fragment. */
  const relax = (input: OptimizerInput, e: Edit): OptimizerInput | null => {
    const c = clone(input);
    if (e.kind === "lowerMin") {
      const s = e.a % NUM_STATS;
      if (c.minimums[s] <= 0) return null;
      c.minimums[s] = Math.max(0, c.minimums[s] - e.amt);
    } else if (e.kind === "mods") {
      const m = c.mods ?? { major: 0, minor: 0 };
      if (m.major + m.minor < 5) {
        if (e.a & 1) m.major++;
        else m.minor++;
      } else if (m.minor > 0) {
        m.minor--;
        m.major++;
      } else return null;
      c.mods = m;
    } else if (e.kind === "artifice") {
      const k = e.a % NUM_SLOTS;
      const p = c.slots[k][e.b % c.slots[k].length];
      if (p.artifice) return null;
      p.artifice = true;
    } else {
      const s = e.a % NUM_STATS;
      c.fragmentBonus = (c.fragmentBonus ?? [0, 0, 0, 0, 0, 0]).slice();
      c.fragmentBonus[s] += Math.ceil(e.amt / 10) * 10;
    }
    return c;
  };

  test("relaxing the query never loses feasibility or lowers a ceiling", () => {
    const cov = newCoverage();
    const kinds: Record<string, number> = {};
    fc.assert(
      fc.property(ANY, editArb, (input, e) => {
        const b = relax(input, e);
        fc.pre(b !== null);
        const ra = run(input);
        const rb = run(b!);
        if (!noteCoverage(cov, input, ra, rb)) return;
        kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        const ctx = `${e.kind} ${show(e)}`;
        if (ra.feasible) expect(rb.feasible, `${ctx}: feasibility lost`).toBe(true);
        // Raising a fragment raises that stat's every value; the OTHER relaxations keep
        // every loadout's stat values achievable — so ceilings can only rise.
        expectCeilingsDominate(ra, rb, ctx);
      }),
      PARAMS(120),
    );
    report(`relax ${JSON.stringify(kinds)}`, cov);
  }, 180_000);
});

describe("metamorphic: options that must be no-ops", () => {
  test("maxResults=N is the top-N prefix of maxResults=M>N", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 200 }), (input, n, extra) => {
        const a = run({ ...input, maxResults: n });
        const b = run({ ...input, maxResults: n + extra });
        if (!noteCoverage(cov, input, a, b)) return;
        expect(a.totals, `N=${n} M=${n + extra}`).toEqual(b.totals.slice(0, n));
        // Ceilings never depend on the list size beyond their seed.
        if (a.exact && b.exact) expect(a.out.ceilings).toEqual(b.out.ceilings);
      }),
      PARAMS(120),
    );
    report("maxResults prefix", cov);
  }, 120_000);

  const stripTuning = (input: OptimizerInput): OptimizerInput => {
    const c = clone(input);
    c.slots = c.slots.map((s) => s.map((p): OptimizerPiece => ({ ...p, tuning: undefined })));
    return c;
  };

  test("allowTuning=false ≡ the same pool with every piece untunable", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.boolean(), (input, bal) => {
        const a = run({ ...input, allowTuning: false, allowBalancedTuning: bal });
        const b = run({ ...stripTuning(input), allowTuning: true, allowBalancedTuning: !bal });
        if (!noteCoverage(cov, input, a, b)) return;
        expectSameResults(a, b, "allowTuning");
      }),
      PARAMS(100),
    );
    report("allowTuning", cov);
  }, 120_000);

  test("allowBalancedTuning is a no-op on a pool with no tunable pieces", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, (input) => {
        const s = stripTuning(input);
        const a = run({ ...s, allowTuning: true, allowBalancedTuning: true });
        const b = run({ ...s, allowTuning: true, allowBalancedTuning: false });
        if (!noteCoverage(cov, input, a, b)) return;
        expectSameResults(a, b, "allowBalanced");
      }),
      PARAMS(80),
    );
    report("allowBalanced", cov);
  }, 120_000);
});

describe("metamorphic: a short budget only ever under-reports", () => {
  /**
   * A time-capped run vs the generous run of the SAME query. Whatever the clock does: its
   * builds are legal, its k-th best never beats the exhaustive k-th best, `capped: false`
   * means identical totals, and its ceiling bracket [ceilings, uppers] contains the exact
   * ceilings (timeouts never become disproofs).
   */
  test("capped / inexact runs bracket the exhaustive run", () => {
    const cov = newCoverage();
    fc.assert(
      fc.property(ANY, fc.constantFrom(0, 1, 2, 5), fc.constantFrom(0, 1, 2, 5), (input, topMs, ceilMs) => {
        const full = run(input);
        if (!noteCoverage(cov, input, full)) return;
        const out = solve(input, { topNBudgetMs: topMs, ceilingBudgetMs: ceilMs });
        for (const lo of out.loadouts) checkLoadout(lo, input, "short-budget legality");
        const short = {
          out,
          feasible: out.loadouts.length > 0,
          totals: out.loadouts.map((l) => l.total),
          exhaustive: !out.capped,
          exact: out.ceilingsExact,
        };
        if (out.capped) cov.shortCapped = (cov.shortCapped ?? 0) + 1;
        if (!out.ceilingsExact) cov.shortInexact = (cov.shortInexact ?? 0) + 1;
        expectTotalsDominate(short, full, `short ${topMs}/${ceilMs}`);
        if (!out.capped) expect(short.totals).toEqual(full.totals);
        for (let s = 0; s < NUM_STATS; s++) {
          expect(out.ceilings[s], `short ceiling ${s}`).toBeLessThanOrEqual(out.ceilingUppers[s]);
          if (full.exact) {
            expect(out.ceilings[s], `short ceiling ${s} over the exact one`).toBeLessThanOrEqual(full.out.ceilings[s]);
            expect(out.ceilingUppers[s], `short upper ${s} under the exact ceiling`).toBeGreaterThanOrEqual(full.out.ceilings[s]);
          }
        }
        if (out.ceilingsExact && full.exact) expect(out.ceilings).toEqual(full.out.ceilings);
      }),
      PARAMS(100),
    );
    report("short budget", cov);
  }, 180_000);
});
