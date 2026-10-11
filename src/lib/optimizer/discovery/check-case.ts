/**
 * One-shot property evaluation for a generated case: runs solve() (default and small
 * maxResults), the independent oracle and both policy-total enumerations, and returns
 * EVERY violated property (no early exit), so a survey can tabulate failure classes.
 */
import { solve } from "../solve";
import { NUM_STATS } from "../floors";
import type { OptimizerInput } from "../types";
import {
  dedupedPolicyTotals,
  loadoutViolations,
  oracle,
  rawPolicyTotals,
  type OracleResult,
} from "./constraint-oracle";

export const GENEROUS = { topNBudgetMs: 60_000, ceilingBudgetMs: 60_000 };

export type ViolationKind =
  | "capped"
  | "feasibility"
  | "legality"
  | "best-over-upper"
  | "ceiling-over"
  | "upper-under"
  | "exact-mismatch"
  | "ceiling-infeasible-over"
  | "upper-infeasible-under"
  | "exact-infeasible-mismatch"
  | "topN-totals"
  | "topN-small-totals"
  | "dedupe-feasibility"
  | "dedupe-max"
  | "dedupe-distinct-totals"
  | "throw";

export interface Violation {
  kind: ViolationKind;
  detail: string;
}

export interface CaseReport {
  violations: Violation[];
  truth: OracleResult;
  capped: boolean;
  ceilingsExact: boolean;
  loadouts: number;
  /** The small-maxResults run cut ≥1 subtree with the admission bound. */
  smallPruned: boolean;
  /** Solver-returned builds whose gear power is null (all-unknown, no weapons). */
  nullPowerBuilds: number;
}

/**
 * solve(), but looking past the dev-only ceiling-invariant throw: production logs, lifts
 * the upper and returns — so the remaining properties are still checked on what users
 * would get. The throw itself is reported through `onThrow`.
 */
export function solveLookingPastThrow(input: OptimizerInput, onThrow: (msg: string) => void) {
  try {
    return solve(input, GENEROUS);
  } catch (e) {
    onThrow(String(e));
    // NODE_ENV is typed read-only; write through a widened view.
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    const err = console.error;
    env.NODE_ENV = "production";
    console.error = () => {};
    try {
      return solve(input, GENEROUS);
    } finally {
      env.NODE_ENV = prev;
      console.error = err;
    }
  }
}

const distinct = (xs: number[]) => [...new Set(xs)].sort((a, b) => b - a);

export function checkCase(input: OptimizerInput, smallN: number): CaseReport {
  const v: Violation[] = [];
  const add = (kind: ViolationKind, detail: string) => v.push({ kind, detail });
  const truth = oracle(input);
  const out = solveLookingPastThrow(input, (e) => add("throw", e));
  if (out.capped) add("capped", "uncapped budget hit");
  if (out.loadouts.length > 0 !== truth.feasible)
    add("feasibility", `solver ${out.loadouts.length} builds, oracle feasible=${truth.feasible}`);
  for (const lo of out.loadouts) {
    const errs = loadoutViolations(lo, input);
    if (errs.length) add("legality", `${lo.pieceIds.join(",")}: ${errs.join("; ")}`);
  }
  if (out.loadouts.length && out.loadouts[0].total > truth.bestTotalUpper)
    add("best-over-upper", `${out.loadouts[0].total} > ${truth.bestTotalUpper}`);

  const pre = truth.feasible ? "" : "infeasible-";
  for (let s = 0; s < NUM_STATS; s++) {
    if (out.ceilings[s] > truth.ceilings[s])
      add(`ceiling-${pre}over` as ViolationKind, `stat ${s}: ceiling ${out.ceilings[s]} > truth ${truth.ceilings[s]}`);
    if (out.ceilingUppers[s] < truth.ceilings[s])
      add(`upper-${pre}under` as ViolationKind, `stat ${s}: upper ${out.ceilingUppers[s]} < truth ${truth.ceilings[s]}`);
  }
  if (out.ceilingsExact && out.ceilings.join() !== truth.ceilings.join())
    add(truth.feasible ? "exact-mismatch" : "exact-infeasible-mismatch", `exact ${out.ceilings} vs truth ${truth.ceilings}`);

  // Pruning invisibility + dedupe soundness against the production tuner's policy totals.
  const ded = dedupedPolicyTotals(input);
  const raw = rawPolicyTotals(input);
  let small: ReturnType<typeof solveLookingPastThrow> | undefined;
  if (!out.capped) {
    const want = ded.slice(0, input.maxResults ?? 200);
    const got = out.loadouts.map((l) => l.total);
    if (got.join() !== want.join()) add("topN-totals", `got [${got.slice(0, 8)}] want [${want.slice(0, 8)}]`);
    small = solveLookingPastThrow({ ...input, maxResults: smallN }, () => {});
    if (!small.capped) {
      const g2 = small.loadouts.map((l) => l.total);
      const w2 = ded.slice(0, smallN);
      if (g2.join() !== w2.join()) add("topN-small-totals", `N=${smallN} got [${g2}] want [${w2}]`);
      for (const lo of small.loadouts) {
        const errs = loadoutViolations(lo, input);
        if (errs.length) add("legality", `(N=${smallN}) ${lo.pieceIds.join(",")}: ${errs.join("; ")}`);
      }
    }
  }
  if ((ded.length > 0) !== (raw.length > 0)) add("dedupe-feasibility", `deduped ${ded.length} vs raw ${raw.length}`);
  if (ded.length && raw.length && ded[0] !== raw[0]) add("dedupe-max", `deduped max ${ded[0]} vs raw ${raw[0]}`);
  if (distinct(ded).join() !== distinct(raw).join())
    add("dedupe-distinct-totals", `deduped {${distinct(ded).slice(0, 8)}} raw {${distinct(raw).slice(0, 8)}}`);
  // Raw enumeration must agree with the independent oracle on feasibility too.
  if ((raw.length > 0) !== truth.feasible) add("feasibility", `raw tuner enumeration ${raw.length} vs oracle ${truth.feasible}`);
  return {
    violations: v,
    truth,
    capped: out.capped,
    ceilingsExact: out.ceilingsExact,
    loadouts: out.loadouts.length,
    smallPruned: small ? !small.combosValidExact : false,
    nullPowerBuilds: out.loadouts.filter((l) => l.power === null).length,
  };
}
