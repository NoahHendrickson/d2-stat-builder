/**
 * Exploratory survey (opt-in: SURVEY=1): sample many generated cases, run every property,
 * tabulate coverage labels and violation kinds, and print one example per kind.
 */
import { describe, test } from "vitest";
import fc from "fast-check";
import { classify, makeCaseArb } from "./constraint-oracle";
import { checkCase } from "./check-case";

const RUNS = Number(process.env.PROP_RUNS ?? 300);
const SEED = Number(process.env.PROP_SEED ?? 12345);

describe.runIf(process.env.SURVEY)("survey", () => {
  test("tabulate", () => {
    const cases = fc.sample(fc.tuple(makeCaseArb({ nonNegative: !!process.env.NONNEG, noSetHash0: !!process.env.NOSET0, noExoticBalancedOnly: !!process.env.NOEXB, maxPerSlot: Number(process.env.PER_SLOT ?? 3) }), fc.integer({ min: 1, max: 5 })), { seed: SEED, numRuns: RUNS });
    const labels = new Map<string, number>();
    const kinds = new Map<string, { n: number; ex: string; input: string }>();
    let capped = 0;
    const t0 = performance.now();
    for (const [c, n] of cases) {
      const r = checkCase(c.input, n);
      if (r.capped) capped++;
      if (r.smallPruned) labels.set("solve:small-N-admission-pruned", (labels.get("solve:small-N-admission-pruned") ?? 0) + 1);
      if (r.nullPowerBuilds && c.input.powerRange) labels.set("solve:null-power-build-returned-under-range", (labels.get("solve:null-power-build-returned-under-range") ?? 0) + 1);
      if (r.ceilingsExact) labels.set("solve:ceilings-exact", (labels.get("solve:ceilings-exact") ?? 0) + 1);
      for (const l of classify(c, r.truth)) labels.set(l, (labels.get(l) ?? 0) + 1);
      for (const v of r.violations) {
        const e = kinds.get(v.kind);
        if (e) e.n++;
        else kinds.set(v.kind, { n: 1, ex: v.detail, input: JSON.stringify(c.input) });
      }
    }
    const lines = [`runs=${RUNS} seed=${SEED} capped=${capped} ms=${Math.round(performance.now() - t0)}`];
    for (const [k, n] of [...labels].sort()) lines.push(`  ${k.padEnd(36)} ${n} (${((100 * n) / RUNS).toFixed(1)}%)`);
    lines.push("violations:");
    for (const [k, e] of kinds) lines.push(`  ${k}: ${e.n}\n    ${e.ex}\n    ${e.input}`);
    console.log(lines.join("\n"));
  }, 600_000);
});
