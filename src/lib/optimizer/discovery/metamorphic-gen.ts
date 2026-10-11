/**
 * Shared generators, transforms and comparison helpers for the metamorphic discovery suite
 * (metamorphic-solve.test.ts, metamorphic-tuner.test.ts).
 *
 * Metamorphic relations compare TWO solver runs on related inputs, so they scale to pools
 * far larger than the exhaustive oracle can enumerate (3–12 pieces per slot here, plus
 * subsamples of the 496-piece real Warlock pool). Every relation is only asserted between
 * runs that are provably exhaustive: `capped === false` for anything about the top-N list,
 * and `ceilingsExact === true` for anything about ceilings. Runs that miss either are
 * counted (coverage stats) and skipped, never compared.
 */
import fc from "fast-check";
import { expect } from "vitest";
import { solve } from "../solve";
import { NUM_SLOTS, NUM_STATS, clamp } from "../floors";
import { realWarlockSlots } from "../real-pool.fixture";
import { buildSlots } from "../bounds";
import { loadoutPower } from "../power";
import { createTuningSearcher, type InternalPiece } from "../tuning";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  OptimizerPiece,
} from "../types";

export const GENEROUS = { topNBudgetMs: 30_000, ceilingBudgetMs: 30_000 };
export const NUM_RUNS = (dflt: number): number => Number(process.env.PROP_RUNS ?? dflt);

// ---------------------------------------------------------------------------
// Piece / pool generators
// ---------------------------------------------------------------------------

const STATS = [0, 1, 2, 3, 4, 5];
const permArb = fc.shuffledSubarray(STATS, { minLength: 6, maxLength: 6 });
/** Unbiased uniform draw in [0, 1) for rate knobs (fast-check biases plain numbers to 0). */
const unit = fc.noBias(fc.integer({ min: 0, max: 9999 })).map((x) => x / 10000);

export type PieceKind = "t5" | "legacy" | "lowroll";

export interface PieceSpec {
  kind: PieceKind;
  perm: number[];
  legacy: number[];
  exotic: boolean;
  intrinsic: number[];
  tunable: boolean;
  /** 0..2 picks among the off stats, 3 = an archetype stat (real pools do this). */
  tunedPick: number;
  artifice: boolean;
  set: number;
  power: number | null;
  hashPick: number;
}

export const pieceSpecArb = (o: { exoticRate: number; artificeRate: number; t5Only?: boolean }): fc.Arbitrary<PieceSpec> =>
  fc.record({
    kind: o.t5Only ? fc.constant<PieceKind>("t5") : fc.constantFrom<PieceKind>("t5", "t5", "t5", "t5", "legacy", "lowroll"),
    perm: permArb,
    legacy: fc.array(fc.integer({ min: 2, max: 30 }), { minLength: 6, maxLength: 6 }),
    exotic: unit.map((x) => x < o.exoticRate),
    // Exotic intrinsic-looking bonus: up to two stats get +2..+10 on top of the roll.
    intrinsic: fc.array(fc.constantFrom(0, 0, 0, 0, 2, 5, 10), { minLength: 6, maxLength: 6 }),
    tunable: unit.map((x) => x < 0.75),
    tunedPick: fc.integer({ min: 0, max: 3 }),
    artifice: unit.map((x) => x < o.artificeRate),
    set: fc.constantFrom(0, 0, 7, 7, 8),
    power: fc.option(fc.integer({ min: 1995, max: 2010 }), { freq: 6 }),
    hashPick: fc.integer({ min: 0, max: 1 }),
  });

export function specToPiece(s: PieceSpec, id: string): OptimizerPiece {
  const off = s.perm.slice(3).sort((a, b) => a - b);
  let stats: number[];
  let tunable = s.tunable;
  let artifice = s.artifice;
  if (s.kind === "t5") {
    stats = [5, 5, 5, 5, 5, 5];
    stats[s.perm[0]] = 30;
    stats[s.perm[1]] = 25;
    stats[s.perm[2]] = 20;
    artifice = false; // Tier-5: tuning, never artifice
  } else if (s.kind === "legacy") {
    // Legacy (Armor 2.0-shaped) roll: no tuning, maybe artifice.
    stats = s.legacy.slice();
    tunable = false;
  } else {
    // Low-roll / lower-tier Armor 3.0: archetype shape with smaller numbers, tunable.
    stats = [2, 2, 2, 2, 2, 2];
    stats[s.perm[0]] = 22;
    stats[s.perm[1]] = 17;
    stats[s.perm[2]] = 12;
    artifice = false;
  }
  if (s.exotic) {
    let nz = 0;
    for (let k = 0; k < NUM_STATS; k++) {
      if (s.intrinsic[k] > 0 && nz < 2) {
        stats[k] += s.intrinsic[k];
        nz++;
      }
    }
  }
  const tuned = s.tunedPick < 3 ? off[s.tunedPick] : s.perm[0];
  return {
    id,
    stats,
    exotic: s.exotic,
    hash: s.exotic ? 1000 + s.hashPick : undefined,
    setHash: s.set || undefined,
    tuning: tunable ? { tuned, offStats: off } : undefined,
    artifice: artifice || undefined,
    power: s.power ?? undefined,
  };
}

export interface GenOpts {
  minPer: number;
  maxPer: number;
  exoticRate?: number;
  artificeRate?: number;
  /** Probability-ish knobs: allow these optional constraints to appear. */
  sets?: boolean;
  power?: boolean;
  exoticModes?: boolean;
  /** Restrict mods to an unambiguous budget (only majors or only minors). */
  unambiguousMods?: boolean;
  /** Tier-5 rolls only and non-negative fragments: no stat can reach the 0-clamp. */
  clean?: boolean;
}

interface QuerySpec {
  pieces: PieceSpec[][];
  refIdx: number[];
  minOn: boolean[];
  minOff: number[];
  major: number;
  minor: number;
  frag: number[];
  exoticMode: "any" | "none" | "require" | "specific";
  setReq: number;
  powerOn: boolean;
  powerLo: number;
  powerWidth: number;
  weapons: number[];
  allowTuning: boolean;
  allowBalanced: boolean;
  maxResults: number;
}

export function queryArb(o: GenOpts): fc.Arbitrary<OptimizerInput> {
  const pieceArb = pieceSpecArb({
    exoticRate: o.exoticRate ?? 0.15,
    artificeRate: o.artificeRate ?? 0.4,
    t5Only: o.clean,
  });
  const spec: fc.Arbitrary<QuerySpec> = fc.noBias(fc.record({
    pieces: fc.array(fc.array(pieceArb, { minLength: o.minPer, maxLength: o.maxPer }), {
      minLength: NUM_SLOTS,
      maxLength: NUM_SLOTS,
    }),
    refIdx: fc.array(fc.nat(50), { minLength: NUM_SLOTS, maxLength: NUM_SLOTS }),
    minOn: fc.array(fc.boolean(), { minLength: NUM_STATS, maxLength: NUM_STATS }),
    minOff: fc.array(fc.integer({ min: -20, max: 15 }), { minLength: NUM_STATS, maxLength: NUM_STATS }),
    major: fc.integer({ min: 0, max: 5 }),
    minor: fc.integer({ min: 0, max: 5 }),
    frag: fc.array(o.clean ? fc.constantFrom(0, 0, 0, 10, 20) : fc.constantFrom(0, 0, 0, 0, 10, 20, -10, -20, -30), {
      minLength: NUM_STATS,
      maxLength: NUM_STATS,
    }),
    exoticMode: o.exoticModes === false
      ? fc.constant("any" as const)
      : fc.constantFrom("any" as const, "any" as const, "none" as const, "require" as const, "specific" as const),
    setReq: o.sets === false ? fc.constant(0) : fc.constantFrom(0, 0, 0, 1, 2, 3),
    powerOn: o.power === false ? fc.constant(false) : unit.map((x) => x < 0.15),
    powerLo: fc.integer({ min: 1995, max: 2008 }),
    powerWidth: fc.integer({ min: 0, max: 6 }),
    weapons: fc.array(fc.integer({ min: 1995, max: 2010 }), { maxLength: 2 }),
    allowTuning: unit.map((x) => x < 0.9),
    allowBalanced: unit.map((x) => x < 0.8),
    maxResults: fc.constantFrom(1, 3, 10, 50, 200),
  }));
  return spec.map((q) => specToInput(q, o));
}

function specToInput(q: QuerySpec, o: GenOpts): OptimizerInput {
  let n = 0;
  const slots = q.pieces.map((sp) => sp.map((s) => specToPiece(s, `p${n++}`)));
  const major = q.major;
  let minor = Math.min(q.minor, 5 - major);
  if (o.unambiguousMods) {
    if (major > 0) minor = 0;
  }
  const ref = slots.map((sp, k) => sp[q.refIdx[k] % sp.length]);
  const mins = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    if (!q.minOn[s]) continue;
    let v = q.frag[s];
    for (const p of ref) v += p.stats[s];
    mins[s] = Math.max(0, Math.min(200, v + q.minOff[s]));
  }
  const exotics = slots.flat().filter((p) => p.exotic);
  const input: OptimizerInput = {
    slots,
    minimums: mins,
    mods: { major, minor },
    fragmentBonus: q.frag,
    allowTuning: q.allowTuning,
    allowBalancedTuning: q.allowBalanced,
    maxResults: q.maxResults,
  };
  if (q.exoticMode === "specific") {
    input.exotic = { mode: "specific", hashes: exotics.length ? [exotics[0].hash!] : [1000] };
  } else {
    input.exotic = { mode: q.exoticMode };
  }
  if (q.setReq === 1) input.setRequirements = [{ setHash: 7, count: 2 }];
  else if (q.setReq === 2) input.setRequirements = [{ setHash: 7, count: 4 }];
  else if (q.setReq === 3) input.setRequirements = [{ setHash: 7, count: 2 }, { setHash: 8, count: 2 }];
  if (q.powerOn) {
    input.powerRange = {
      min: q.powerLo,
      max: q.powerLo + q.powerWidth,
      weapons: q.weapons.length ? q.weapons : undefined,
    };
  }
  return input;
}

/** Subsample of the real 496-piece Warlock pool: `per` pieces per slot picked by index. */
export function realSubsampleArb(minPer: number, maxPer: number): fc.Arbitrary<OptimizerInput> {
  const real = realWarlockSlots();
  return fc
    .record({
      picks: fc.array(
        fc.uniqueArray(fc.nat(10_000), { minLength: minPer, maxLength: maxPer }),
        { minLength: NUM_SLOTS, maxLength: NUM_SLOTS },
      ),
      refIdx: fc.array(fc.nat(50), { minLength: NUM_SLOTS, maxLength: NUM_SLOTS }),
      minOn: fc.array(fc.boolean(), { minLength: NUM_STATS, maxLength: NUM_STATS }),
      minOff: fc.array(fc.integer({ min: -20, max: 15 }), { minLength: NUM_STATS, maxLength: NUM_STATS }),
      major: fc.integer({ min: 0, max: 5 }),
      minor: fc.integer({ min: 0, max: 5 }),
      frag: fc.array(fc.constantFrom(0, 0, 0, 10, -10, -20), { minLength: NUM_STATS, maxLength: NUM_STATS }),
      setReq: fc.constantFrom(0, 0, 1, 2),
      maxResults: fc.constantFrom(1, 10, 200),
    })
    .map((q) => {
      const slots = real.map((pool, k) => {
        const seen = new Set<number>();
        const out: OptimizerPiece[] = [];
        for (const i of q.picks[k]) {
          const j = i % pool.length;
          if (seen.has(j)) continue;
          seen.add(j);
          out.push({ ...pool[j] });
        }
        return out;
      });
      const ref = slots.map((sp, k) => sp[q.refIdx[k] % sp.length]);
      const mins = new Array(NUM_STATS).fill(0);
      for (let s = 0; s < NUM_STATS; s++) {
        if (!q.minOn[s]) continue;
        let v = q.frag[s];
        for (const p of ref) v += p.stats[s];
        mins[s] = Math.max(0, Math.min(200, v + q.minOff[s]));
      }
      const input: OptimizerInput = {
        slots,
        minimums: mins,
        mods: { major: q.major, minor: Math.min(q.minor, 5 - q.major) },
        fragmentBonus: q.frag,
        exotic: { mode: "any" },
        maxResults: q.maxResults,
      };
      // Real set hashes (CODA = 1490136267).
      if (q.setReq === 1) input.setRequirements = [{ setHash: 1490136267, count: 2 }];
      else if (q.setReq === 2) input.setRequirements = [{ setHash: 3734029045, count: 2 }];
      return input;
    });
}

/**
 * Push a query onto its feasibility boundary: solve it once, then set 1–3 minimums to the
 * proven ceiling of that stat plus δ ∈ [−2, +1] (applied in sequence, re-solving between
 * steps so each target is the ceiling under the previous ones). These queries sit where the
 * slow-path tuner, the joint-min bound and the probes do their hardest work.
 */
export function boundaryArb(base: fc.Arbitrary<OptimizerInput>): fc.Arbitrary<OptimizerInput> {
  return fc
    .tuple(
      base,
      fc.array(fc.record({ s: fc.nat(5), d: fc.integer({ min: -2, max: 1 }) }), {
        minLength: 1,
        maxLength: 3,
      }),
    )
    .map(([input, picks]) => {
      let cur = input;
      for (const { s, d } of picks) {
        const out = solve(cur, GENEROUS);
        if (!out.ceilingsExact || out.loadouts.length === 0) break;
        const next = clone(cur);
        next.minimums[s] = Math.max(0, Math.min(200, out.ceilings[s] + d));
        cur = next;
      }
      return cur;
    });
}

// ---------------------------------------------------------------------------
// Running + summarizing
// ---------------------------------------------------------------------------

export interface Summary {
  out: OptimizerOutput;
  feasible: boolean;
  totals: number[];
  /** Top-N exhaustive (uncapped). */
  exhaustive: boolean;
  /** Ceilings proven exact. */
  exact: boolean;
}

export function run(input: OptimizerInput): Summary {
  const out = solve(input, GENEROUS);
  for (const lo of out.loadouts) checkLoadout(lo, input, "legality");
  return {
    out,
    feasible: out.loadouts.length > 0,
    totals: out.loadouts.map((l) => l.total),
    exhaustive: !out.capped,
    exact: out.ceilingsExact,
  };
}

export interface Coverage {
  cases: number;
  feasible: number;
  capped: number;
  inexact: number;
  compared: number;
  power: number;
  sets: number;
  artifice: number;
  slowPath?: number;
  [k: string]: number | undefined;
}

export const newCoverage = (): Coverage => ({
  cases: 0,
  feasible: 0,
  capped: 0,
  inexact: 0,
  compared: 0,
  power: 0,
  sets: 0,
  artifice: 0,
});

export function noteCoverage(c: Coverage, input: OptimizerInput, a: Summary, b?: Summary): boolean {
  c.cases++;
  if (a.feasible) c.feasible++;
  if (!a.exhaustive || (b && !b.exhaustive)) c.capped++;
  if (!a.exact || (b && !b.exact)) c.inexact++;
  if (input.powerRange) c.power++;
  if (input.setRequirements?.length) c.sets++;
  if (input.slots.some((s) => s.some((p) => p.artifice))) c.artifice++;
  const bump = (k: string): void => {
    c[k] = (c[k] ?? 0) + 1;
  };
  if (!a.out.combosValidExact) bump("admissionPruned");
  if (a.out.loadouts.some((l) => l.tuning.some((t) => t?.kind === "directional"))) bump("directional");
  if (a.out.loadouts.some((l) => l.artifice.some((x) => x !== null))) bump("artificeUsed");
  if (a.out.loadouts.length > 0 && a.out.loadouts.length === (input.maxResults ?? 200)) bump("heapFull");
  if (input.minimums.filter((m) => m > 0).length >= 3) bump("mins3plus");
  const ok = a.exhaustive && (!b || b.exhaustive);
  if (ok) c.compared++;
  return ok;
}

/** Equal-feasibility + equal totals + equal ceilings (when both exact). */
export function expectSameResults(a: Summary, b: Summary, ctx: string, opts: { ceilPerm?: number[] } = {}): void {
  expect(b.feasible, `${ctx}: feasibility`).toBe(a.feasible);
  expect(b.totals, `${ctx}: totals`).toEqual(a.totals);
  if (a.exact && b.exact) {
    const want = opts.ceilPerm ? permuteStats(a.out.ceilings, opts.ceilPerm) : a.out.ceilings;
    expect(b.out.ceilings, `${ctx}: ceilings`).toEqual(want);
  } else {
    expectBracketsOverlap(a, b, ctx, opts.ceilPerm);
  }
}

/**
 * Inexact ceilings still carry proven brackets [ceilings, uppers]; the true value is in
 * both, so the two brackets must intersect.
 */
export function expectBracketsOverlap(a: Summary, b: Summary, ctx: string, perm?: number[]): void {
  const aLo = perm ? permuteStats(a.out.ceilings, perm) : a.out.ceilings;
  const aHi = perm ? permuteStats(a.out.ceilingUppers, perm) : a.out.ceilingUppers;
  for (let s = 0; s < NUM_STATS; s++) {
    expect(aLo[s], `${ctx}: bracket ${s}`).toBeLessThanOrEqual(b.out.ceilingUppers[s]);
    expect(b.out.ceilings[s], `${ctx}: bracket ${s}`).toBeLessThanOrEqual(aHi[s]);
  }
}

/** b's k-th best total ≥ a's k-th best for every k a has; b at least as long. */
export function expectTotalsDominate(a: Summary, b: Summary, ctx: string): void {
  expect(b.totals.length, `${ctx}: list length`).toBeGreaterThanOrEqual(a.totals.length);
  for (let k = 0; k < a.totals.length; k++) {
    expect(b.totals[k], `${ctx}: ${k}-th best total`).toBeGreaterThanOrEqual(a.totals[k]);
  }
}

/** Ceilings of b ≥ ceilings of a (proven: compare b's upper with a's achievable). */
export function expectCeilingsDominate(a: Summary, b: Summary, ctx: string): void {
  for (let s = 0; s < NUM_STATS; s++) {
    // a.ceilings is achievable for a; anything achievable for a is achievable for b,
    // so b's PROVEN upper must be ≥ it; when both are exact the values compare directly.
    expect(b.out.ceilingUppers[s], `${ctx}: ceiling upper ${s}`).toBeGreaterThanOrEqual(a.out.ceilings[s]);
    if (a.exact && b.exact) {
      expect(b.out.ceilings[s], `${ctx}: ceiling ${s}`).toBeGreaterThanOrEqual(a.out.ceilings[s]);
    }
  }
}

/**
 * The policy totals of EVERY legal combo of the (production-deduped) pool, each scored by
 * the production leaf tuner in maximize mode — no walk, no bounds, no heap. The uncapped
 * top-N must be exactly this list's prefix: it is the "pruning is invisible" contract,
 * checkable on pools far beyond the rule-level oracle (12^5 ≈ 250k combos is ~1 s).
 * Returns null when the pool is too big to enumerate.
 */
export function bruteTopTotals(input: OptimizerInput, n: number, maxCombos = 300_000): number[] | null {
  const slots = buildSlots(input);
  let combos = 1;
  for (const s of slots) combos *= s.length;
  if (combos > maxCombos) return null;
  if (slots.some((s) => s.length === 0)) return [];
  const mode = input.exotic?.mode ?? "any";
  const needExotic = mode === "require" || mode === "specific";
  const reqs = input.setRequirements ?? [];
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const tuner = createTuningSearcher(frag, input.mods ?? { major: 0, minor: 0 });
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const totals: number[] = [];
  const rec = (k: number, ex: number): void => {
    if (k === NUM_SLOTS) {
      if (needExotic && ex !== 1) return;
      for (const r of reqs) if (chosen.filter((p) => p.setHash === r.setHash).length < r.count) return;
      if (input.powerRange) {
        const pw = loadoutPower(chosen, input.powerRange.weapons);
        if (pw !== null && (pw < input.powerRange.min || pw > input.powerRange.max)) return;
      }
      const sum = new Array(NUM_STATS).fill(0);
      for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
      const r = tuner(chosen, sum, input.minimums, "maximize");
      if (r) totals.push(r.total);
      return;
    }
    for (const p of slots[k]) {
      const e = ex + (p.exotic ? 1 : 0);
      if (e > 1) continue;
      chosen[k] = p;
      rec(k + 1, e);
    }
  };
  rec(0, 0);
  totals.sort((a, b) => b - a);
  return totals.slice(0, n);
}

/**
 * True per-stat ceilings by enumeration: for each stat t, the largest v ≤ 200 such that
 * SOME legal combo of the deduped pool passes the production tuner (feasible mode) with
 * minimum t replaced by v. The tuner's own completeness is checked separately against a
 * rule-level brute force (metamorphic-tuner.test.ts), so this isolates the ceiling walk's
 * bounds, scheduling and witness harvest. Null when the pool is too big.
 */
export function bruteCeilings(input: OptimizerInput, maxCombos = 20_000): number[] | null {
  const slots = buildSlots(input);
  let combos = 1;
  for (const s of slots) combos *= s.length;
  if (combos > maxCombos) return null;
  const ceil = new Array(NUM_STATS).fill(0);
  if (slots.some((s) => s.length === 0)) return ceil;
  const mode = input.exotic?.mode ?? "any";
  const needExotic = mode === "require" || mode === "specific";
  const reqs = input.setRequirements ?? [];
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const tuner = createTuningSearcher(frag, input.mods ?? { major: 0, minor: 0 });
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const mins = input.minimums.slice();
  const rec = (k: number, ex: number): void => {
    if (k === NUM_SLOTS) {
      if (needExotic && ex !== 1) return;
      for (const r of reqs) if (chosen.filter((p) => p.setHash === r.setHash).length < r.count) return;
      if (input.powerRange) {
        const pw = loadoutPower(chosen, input.powerRange.weapons);
        if (pw !== null && (pw < input.powerRange.min || pw > input.powerRange.max)) return;
      }
      const sum = new Array(NUM_STATS).fill(0);
      for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
      for (let t = 0; t < NUM_STATS; t++) {
        const ok = (v: number): boolean => {
          mins[t] = v;
          const r = tuner(chosen, sum, mins, "feasible") !== null;
          mins[t] = input.minimums[t];
          return r;
        };
        // Only a combo that beats the best so far matters: binary search above it.
        let lo = ceil[t];
        if (!ok(lo + 1 > 200 ? 200 : lo + 1)) {
          if (lo === 0 && ok(0)) ceil[t] = 0;
          continue;
        }
        lo = Math.min(200, lo + 1);
        let hi = 200;
        while (lo < hi) {
          const mid = lo + Math.ceil((hi - lo) / 2);
          if (ok(mid)) lo = mid;
          else hi = mid - 1;
        }
        ceil[t] = lo;
      }
      return;
    }
    for (const p of slots[k]) {
      const e = ex + (p.exotic ? 1 : 0);
      if (e > 1) continue;
      chosen[k] = p;
      rec(k + 1, e);
    }
  };
  rec(0, 0);
  return ceil;
}

/**
 * True when no stat can go below 0 before clamping in ANY loadout of the pool: the lowest
 * roll per slot plus the fragment minus every −5 directional the five pieces could land.
 * On such pools the 0-clamp never absorbs a −5 (see FINDING T1).
 */
export function clampFree(input: OptimizerInput): boolean {
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  for (let s = 0; s < NUM_STATS; s++) {
    let low = frag[s];
    for (const slot of input.slots) low += Math.min(...slot.map((p) => p.stats[s]));
    if (low - 25 < 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export const clone = (input: OptimizerInput): OptimizerInput =>
  JSON.parse(JSON.stringify(input)) as OptimizerInput;

/** newVec[perm[s]] = vec[s]. */
export function permuteStats(vec: number[], perm: number[]): number[] {
  const out = new Array(vec.length).fill(0);
  for (let s = 0; s < vec.length; s++) out[perm[s]] = vec[s];
  return out;
}

export function relabelStats(input: OptimizerInput, perm: number[]): OptimizerInput {
  const c = clone(input);
  for (const slot of c.slots) {
    for (const p of slot) {
      p.stats = permuteStats(p.stats, perm);
      if (p.tuning) {
        p.tuning.tuned = perm[p.tuning.tuned];
        p.tuning.offStats = p.tuning.offStats.map((s) => perm[s]).sort((a, b) => a - b);
      }
    }
  }
  c.minimums = permuteStats(c.minimums, perm);
  if (c.fragmentBonus) c.fragmentBonus = permuteStats(c.fragmentBonus, perm);
  return c;
}

export function permuteSlots(input: OptimizerInput, perm: number[]): OptimizerInput {
  const c = clone(input);
  c.slots = perm.map((k) => c.slots[k]);
  return c;
}

/** Rotate / reverse each slot's piece order by a per-slot key. */
export function reorderWithinSlots(input: OptimizerInput, keys: number[]): OptimizerInput {
  const c = clone(input);
  c.slots = c.slots.map((slot, k) => {
    const key = keys[k % keys.length];
    const r = slot.slice();
    if (key & 1) r.reverse();
    const rot = key % Math.max(1, r.length);
    return r.slice(rot).concat(r.slice(0, rot));
  });
  return c;
}

// ---------------------------------------------------------------------------
// Build legality (copied from completeness-oracle.test.ts so this stays independent)
// ---------------------------------------------------------------------------

export function checkLoadout(lo: OptimizerLoadout, input: OptimizerInput, ctx: string): void {
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const pieces = lo.pieceIds.map((id, k) => {
    const p = input.slots[k].find((q) => q.id === id);
    expect(p, `${ctx}: piece ${id} not in slot ${k}`).toBeDefined();
    return p!;
  });
  const exotics = pieces.filter((p) => p.exotic).length;
  expect(exotics, ctx).toBeLessThanOrEqual(1);
  const mode = input.exotic?.mode ?? "any";
  if (mode === "none") expect(exotics, ctx).toBe(0);
  if (mode === "require" || mode === "specific") expect(exotics, ctx).toBe(1);
  if (mode === "specific") {
    const ex = pieces.find((p) => p.exotic)!;
    expect(input.exotic?.hashes ?? [], ctx).toContain(ex.hash);
  }
  for (const r of input.setRequirements ?? []) {
    expect(pieces.filter((p) => p.setHash === r.setHash).length, ctx).toBeGreaterThanOrEqual(r.count);
  }
  if (input.powerRange) {
    const ws = input.powerRange.weapons ?? [];
    let sum = 0;
    let n = ws.length;
    for (const w of ws) sum += w;
    for (const p of pieces) if (p.power !== undefined) { sum += p.power; n++; }
    if (n > 0) {
      const pw = Math.floor(sum / n);
      expect(pw, `${ctx}: power`).toBeGreaterThanOrEqual(input.powerRange.min);
      expect(pw, `${ctx}: power`).toBeLessThanOrEqual(input.powerRange.max);
    }
  }
  const tuningSum = [0, 0, 0, 0, 0, 0];
  lo.tuning.forEach((t, k) => {
    const p = pieces[k];
    if (t === null) return;
    expect(p.tuning, `${ctx}: untunable piece ${p.id} was tuned`).toBeDefined();
    expect(input.allowTuning ?? true, ctx).toBe(true);
    if (t.kind === "balanced") {
      expect(input.allowBalancedTuning ?? true, ctx).toBe(true);
      for (const s of p.tuning!.offStats) tuningSum[s] += 1;
    } else {
      expect(p.tuning!.directional, ctx).not.toBe(false);
      if (!p.exotic) expect(t.plus, ctx).toBe(p.tuning!.tuned);
      expect(t.minus, ctx).not.toBe(t.plus);
      tuningSum[t.plus] += 5;
      tuningSum[t.minus] -= 5;
    }
  });
  expect(lo.tuningBonus, ctx).toEqual(tuningSum);
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  expect(lo.modsUsed.major, ctx).toBeLessThanOrEqual(major);
  expect(lo.modsUsed.minor, ctx).toBeLessThanOrEqual(minor);
  expect(lo.modBonus.reduce((a, b) => a + b, 0), ctx).toBe(lo.modsUsed.major * 10 + lo.modsUsed.minor * 5);
  const artPieces = pieces.filter((p) => p.artifice).length;
  const artPoints = lo.artificeBonus.reduce((a, b) => a + b, 0);
  expect(artPoints % 3, ctx).toBe(0);
  expect(artPoints / 3, ctx).toBeLessThanOrEqual(artPieces);
  let total = 0;
  for (let s = 0; s < NUM_STATS; s++) {
    let base = frag[s];
    for (const p of pieces) base += p.stats[s];
    const v = clamp(base + lo.tuningBonus[s] + lo.modBonus[s] + lo.artificeBonus[s]);
    expect(lo.stats[s], `${ctx}: stat ${s} reconstruction`).toBe(v);
    expect(lo.stats[s], `${ctx}: stat ${s} below minimum`).toBeGreaterThanOrEqual(Math.min(input.minimums[s], 200));
    total += v;
  }
  expect(lo.total, ctx).toBe(total);
}

/** Compact JSON for repro messages. */
export const show = (x: unknown): string => JSON.stringify(x);
