/**
 * Discovery helpers for the time-pressure / seeding honesty suite.
 *
 *  - An independent exhaustive oracle (copied from completeness-oracle.test.ts and
 *    extended with the armor power range), reporting per-stat ceilings for feasible AND
 *    infeasible queries (max of stat t subject to the OTHER five minimums; 0 when no
 *    build meets those five).
 *  - A framework-free loadout legality checker (returns an error string).
 *  - fast-check arbitraries for queries (tiny / wide / degenerate pools) and for
 *    deterministic `performance.now` schedules (steps + jumps at chosen call indices).
 *
 * Shares nothing with the production pruning: tuning vectors, coverings and the power
 * rule are re-derived from the game rules.
 */
import fc from "fast-check";
import { NUM_SLOTS, NUM_STATS, clamp } from "../floors";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerPiece,
  SetRequirement,
} from "../types";

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

export function oracleTuneVecs(p: OptimizerPiece, input: OptimizerInput): number[][] {
  const zero = [0, 0, 0, 0, 0, 0];
  if ((input.allowTuning ?? true) === false || !p.tuning) return [zero];
  const out: number[][] = [zero];
  if (input.allowBalancedTuning ?? true) {
    const bal = zero.slice();
    for (const s of p.tuning.offStats) bal[s] += 1;
    out.push(bal);
  }
  if (p.tuning.directional === false) return out;
  const plusStats = p.exotic ? [0, 1, 2, 3, 4, 5] : [p.tuning.tuned];
  for (const plus of plusStats) {
    for (let minus = 0; minus < NUM_STATS; minus++) {
      if (minus === plus) continue;
      const v = zero.slice();
      v[plus] += 5;
      v[minus] -= 5;
      out.push(v);
    }
  }
  return out;
}

export function exoticAllowed(p: OptimizerPiece, input: OptimizerInput): boolean {
  if (!p.exotic) return true;
  const mode = input.exotic?.mode ?? "any";
  if (mode === "none") return false;
  if (mode === "specific") return p.hash !== undefined && !!input.exotic?.hashes?.includes(p.hash);
  return true;
}

/** Gear power the game way: floor(mean) over known-power pieces + weapons; null = none. */
export function oraclePower(pieces: OptimizerPiece[], weapons: number[] = []): number | null {
  const known = [...weapons, ...pieces.filter((p) => p.power !== undefined).map((p) => p.power!)];
  if (known.length === 0) return null;
  return Math.floor(known.reduce((a, b) => a + b, 0) / known.length);
}

function powerOk(pieces: OptimizerPiece[], input: OptimizerInput): boolean {
  const r = input.powerRange;
  if (!r) return true;
  const pw = oraclePower(pieces, r.weapons);
  if (pw === null) return true;
  return pw >= r.min && pw <= r.max;
}

/** Best leftover mod points over every covering of `deficits` (−1 = no covering). */
function coverings(deficits: number[], major: number, minor: number, art: number): number {
  let best = -1;
  const rec = (s: number, M: number, m: number, A: number): void => {
    if (s === NUM_STATS) {
      const leftover = M * 10 + m * 5 + A * 3;
      if (leftover > best) best = leftover;
      return;
    }
    const d = deficits[s];
    if (d <= 0) {
      rec(s + 1, M, m, A);
      return;
    }
    for (let a = 0; a <= M; a++) {
      for (let b = 0; b <= m; b++) {
        for (let c = 0; c <= A; c++) {
          if (a * 10 + b * 5 + c * 3 >= d) rec(s + 1, M - a, m - b, A - c);
        }
      }
    }
  };
  rec(0, major, minor, art);
  return best;
}

export interface OracleResult {
  feasible: boolean;
  /** Per stat: max final value subject to the OTHER five minimums (0 when none). */
  ceilings: number[];
  /** Per stat: whether ANY legal build meets the other five minimums. */
  ceilingDefined: boolean[];
  /** Number of legal piece combos (exotic/set/power legal), ignoring stats. */
  legalCombos: number;
}

export function oracle(input: OptimizerInput): OracleResult {
  const mins = input.minimums;
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const mode = input.exotic?.mode ?? "any";
  const needExotic = mode === "require" || mode === "specific";
  const res: OracleResult = {
    feasible: false,
    ceilings: new Array(NUM_STATS).fill(0),
    ceilingDefined: new Array(NUM_STATS).fill(false),
    legalCombos: 0,
  };
  const chosen: OptimizerPiece[] = new Array(NUM_SLOTS);
  const deficits = new Array(NUM_STATS).fill(0);
  const memo = new Map<string, number>();
  const cover = (art: number): number => {
    const key = `${deficits.join(",")}|${art}`;
    let v = memo.get(key);
    if (v === undefined) {
      v = coverings(deficits, major, minor, art);
      memo.set(key, v);
    }
    return v;
  };

  const evalCombo = (): void => {
    let exotics = 0;
    let art = 0;
    for (const p of chosen) {
      if (p.exotic) exotics++;
      if (p.artifice) art++;
    }
    if (exotics > 1) return;
    if (needExotic && exotics !== 1) return;
    for (const r of reqs) {
      if (chosen.filter((p) => p.setHash === r.setHash).length < r.count) return;
    }
    if (!powerOk(chosen, input)) return;
    res.legalCombos++;
    const vecs = chosen.map((p) => oracleTuneVecs(p, input));
    const pre = new Array(NUM_STATS).fill(0);
    const recTune = (i: number): void => {
      if (i === NUM_SLOTS) {
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = mins[s] > 0 && pre[s] < mins[s] ? mins[s] - pre[s] : 0;
        }
        if (cover(art) >= 0) res.feasible = true;
        for (let t = 0; t < NUM_STATS; t++) {
          const saved = deficits[t];
          deficits[t] = 0;
          const left = cover(art);
          deficits[t] = saved;
          if (left < 0) continue;
          res.ceilingDefined[t] = true;
          const v = clamp(pre[t] + left);
          if (v > res.ceilings[t]) res.ceilings[t] = v;
        }
        return;
      }
      for (const v of vecs[i]) {
        for (let s = 0; s < NUM_STATS; s++) pre[s] += v[s];
        recTune(i + 1);
        for (let s = 0; s < NUM_STATS; s++) pre[s] -= v[s];
      }
    };
    for (let s = 0; s < NUM_STATS; s++) {
      pre[s] = frag[s];
      for (const p of chosen) pre[s] += p.stats[s];
    }
    recTune(0);
  };
  const recSlot = (k: number): void => {
    if (k === NUM_SLOTS) {
      evalCombo();
      return;
    }
    for (const p of input.slots[k] ?? []) {
      if (!exoticAllowed(p, input)) continue;
      chosen[k] = p;
      recSlot(k + 1);
    }
  };
  if (input.slots.length === NUM_SLOTS) recSlot(0);
  return res;
}

// ---------------------------------------------------------------------------
// Legality + reconstruction of a returned build (framework-free)
// ---------------------------------------------------------------------------

export function loadoutError(lo: OptimizerLoadout, input: OptimizerInput): string | null {
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const pieces: OptimizerPiece[] = [];
  for (let k = 0; k < NUM_SLOTS; k++) {
    const p = input.slots[k].find((q) => q.id === lo.pieceIds[k]);
    if (!p) return `piece ${lo.pieceIds[k]} not in slot ${k}`;
    if (!exoticAllowed(p, input)) return `ineligible exotic ${p.id}`;
    pieces.push(p);
  }
  const exotics = pieces.filter((p) => p.exotic).length;
  if (exotics > 1) return "two exotics";
  const mode = input.exotic?.mode ?? "any";
  if ((mode === "require" || mode === "specific") && exotics !== 1) return "exotic required";
  for (const r of input.setRequirements ?? []) {
    if (pieces.filter((p) => p.setHash === r.setHash).length < r.count) return "set req";
  }
  if (!powerOk(pieces, input)) return "power range";
  const tuningSum = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < NUM_SLOTS; k++) {
    const t = lo.tuning[k];
    const p = pieces[k];
    if (t === null) continue;
    if (!p.tuning || input.allowTuning === false) return `illegal tune on ${p.id}`;
    if (t.kind === "balanced") {
      if (input.allowBalancedTuning === false) return "balanced disallowed";
      for (const s of p.tuning.offStats) tuningSum[s] += 1;
    } else {
      if (p.tuning.directional === false) return "directional on balanced-only";
      if (!p.exotic && t.plus !== p.tuning.tuned) return "legendary plus";
      if (t.minus === t.plus) return "plus==minus";
      tuningSum[t.plus] += 5;
      tuningSum[t.minus] -= 5;
    }
  }
  if (lo.tuningBonus.join() !== tuningSum.join()) return "tuningBonus mismatch";
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  if (lo.modsUsed.major > major || lo.modsUsed.minor > minor) return "mod budget";
  if (lo.modBonus.reduce((a, b) => a + b, 0) > lo.modsUsed.major * 10 + lo.modsUsed.minor * 5)
    return "modBonus > mods used";
  const artPieces = pieces.filter((p) => p.artifice).length;
  const artPoints = lo.artificeBonus.reduce((a, b) => a + b, 0);
  if (artPoints % 3 !== 0 || artPoints / 3 > artPieces) return "artifice budget";
  let total = 0;
  for (let s = 0; s < NUM_STATS; s++) {
    let base = frag[s];
    for (const p of pieces) base += p.stats[s];
    const v = clamp(base + lo.tuningBonus[s] + lo.modBonus[s] + lo.artificeBonus[s]);
    if (lo.stats[s] !== v) return `stat ${s} reconstruction ${lo.stats[s]} != ${v}`;
    if (lo.stats[s] < Math.min(input.minimums[s], 200)) return `stat ${s} below minimum`;
    total += v;
  }
  if (lo.total !== total) return "total mismatch";
  return null;
}

// ---------------------------------------------------------------------------
// Query generators
// ---------------------------------------------------------------------------

/**
 * tiny/wide/huge/tunerHeavy/emptySlot/ineligibleSlot are oracle-sized. `big` is NOT
 * (too many combos × tunings for the naive oracle): its reference is the frozen-clock
 * cold run, which the oracle-sized shapes validate against the oracle.
 */
export type PoolShape = "tiny" | "wide" | "huge" | "tunerHeavy" | "big" | "tunerBig" | "emptySlot" | "ineligibleSlot";
export const ORACLE_SHAPES: PoolShape[] = ["tiny", "wide", "huge", "tunerHeavy", "emptySlot", "ineligibleSlot"];

const tier5 = [30, 25, 20, 5, 5, 5];

const arbStats: fc.Arbitrary<number[]> = fc.oneof(
  { weight: 4, arbitrary: fc.shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 6, maxLength: 6 }).map((perm) => {
    const st = new Array(6).fill(0);
    perm.forEach((s, i) => (st[s] = tier5[i]));
    return st;
  }) },
  { weight: 1, arbitrary: fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 6, maxLength: 6 }) },
);

interface PieceSpec {
  stats: number[];
  tunable: boolean;
  tunedPick: number;
  balancedOnly: boolean;
  artifice: boolean;
  set: number; // 0 none, 7, 8
  power: number | null; // null = unknown
  hashPick: number;
}

const arbPieceSpec: fc.Arbitrary<PieceSpec> = fc.record({
  stats: arbStats,
  tunable: fc.boolean(),
  tunedPick: fc.integer({ min: 0, max: 2 }),
  balancedOnly: fc.oneof({ weight: 6, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  artifice: fc.boolean(),
  set: fc.constantFrom(0, 0, 7, 7, 8),
  power: fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 0, max: 20 }) }, { weight: 1, arbitrary: fc.constant(null) }),
  hashPick: fc.integer({ min: 0, max: 1 }),
});

export interface QuerySpec {
  shape: PoolShape;
  slots: PieceSpec[][];
  exoticSlot: number; // -1 none
  exoticCount: number; // exotic pieces in that slot (1..2)
  minMask: boolean[];
  minRef: number[];
  minDelta: number[];
  major: number;
  minor: number;
  frag: number[];
  allowTuning: boolean;
  allowBalanced: boolean;
  exoticMode: "any" | "require" | "specific" | "none";
  setReq: { set: number; count: number } | null;
  power: { lo: number; width: number; weapons: number[] } | null;
  maxResults: number | undefined;
  degenerateSlot: number;
}

export function arbQuerySpec(shapes: PoolShape[] = ["tiny", "tiny", "tiny", "wide", "wide", "wide", "emptySlot", "ineligibleSlot"]): fc.Arbitrary<QuerySpec> {
  return fc.constantFrom(...shapes).chain((shape) => {
    const per =
      shape === "wide"
        ? { minLength: 2, maxLength: 6 }
        : shape === "huge"
          ? { minLength: 9, maxLength: 10 }
          : shape === "big"
            ? { minLength: 8, maxLength: 13 }
          : shape === "tunerBig"
            ? { minLength: 5, maxLength: 9 }
          : shape === "tunerHeavy"
            ? { minLength: 1, maxLength: 1 }
            : { minLength: 1, maxLength: 2 };
    return fc.record({
      shape: fc.constant(shape),
      slots: fc.array(fc.array(arbPieceSpec, per), { minLength: 5, maxLength: 5 }),
      exoticSlot: fc.integer({ min: -1, max: 4 }),
      exoticCount: fc.integer({ min: 1, max: 2 }),
      minMask: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
      minRef: fc.array(fc.nat(5), { minLength: 5, maxLength: 5 }),
      minDelta: fc.array(fc.integer({ min: -14, max: 10 }), { minLength: 6, maxLength: 6 }),
      major: fc.integer({ min: 0, max: 4 }),
      minor: fc.integer({ min: 0, max: 2 }),
      frag: fc.array(fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: -2, max: 2 }).map((x) => x * 10) }), { minLength: 6, maxLength: 6 }),
      allowTuning: fc.oneof({ weight: 9, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
      allowBalanced: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
      exoticMode: fc.constantFrom("any", "any", "require", "specific", "none"),
      setReq: fc.option(fc.record({ set: fc.constantFrom(7, 8), count: fc.integer({ min: 1, max: 4 }) }), { freq: 3 }),
      power: fc.option(
        fc.record({
          lo: fc.integer({ min: 0, max: 20 }),
          width: fc.integer({ min: 0, max: 8 }),
          weapons: fc.array(fc.integer({ min: 0, max: 25 }), { maxLength: 2 }),
        }),
        { freq: 3 },
      ),
      maxResults: fc.constantFrom(undefined, 1, 1, 2, 3, 5),
      degenerateSlot: fc.integer({ min: 0, max: 4 }),
    });
  });
}

/** Turn a spec into a concrete OptimizerInput, bounding the oracle's tuning product. */
export function buildQuery(spec: QuerySpec): OptimizerInput {
  let n = 0;
  let tunableLegendaries = 0;
  const maxTunable =
    spec.shape === "wide"
      ? 2
      : spec.shape === "huge"
        ? 0
        : spec.shape === "tunerHeavy" || spec.shape === "big" || spec.shape === "tunerBig"
          ? 99
          : 3;
  const tunerBig = spec.shape === "tunerBig";
  const slots: OptimizerPiece[][] = spec.slots.map((sp, k) =>
    sp.map((ps, i) => {
      const exotic = k === spec.exoticSlot && i < spec.exoticCount;
      let tunable = spec.shape === "tunerHeavy" || tunerBig ? true : ps.tunable;
      if (spec.shape === "huge" && exotic) tunable = false;
      if (!exotic && tunable) {
        if (tunableLegendaries >= maxTunable) tunable = false;
        else tunableLegendaries++;
      }
      // Wide pools: at most one tunable exotic (31 tuning vectors) — oracle budget.
      if (exotic && spec.shape === "wide" && i > 0) tunable = false;
      const order = [0, 1, 2, 3, 4, 5].sort((a, b) => ps.stats[a] - ps.stats[b] || a - b);
      const off = order.slice(0, 3).sort((a, b) => a - b);
      const p: OptimizerPiece = {
        id: `p${n++}`,
        stats: ps.stats.slice(),
        exotic,
        hash: exotic ? 1000 + ps.hashPick : undefined,
        setHash: ps.set || undefined,
        artifice: !tunable && ps.artifice ? true : undefined,
        tuning: tunable
          ? { tuned: off[ps.tunedPick], offStats: off, ...(ps.balancedOnly ? { directional: false as const } : {}) }
          : undefined,
        power: ps.power === null ? undefined : 1990 + ps.power,
      };
      return p;
    }),
  );
  if (spec.shape === "emptySlot") slots[spec.degenerateSlot] = [];
  if (spec.shape === "ineligibleSlot") {
    // Only exotics in this slot, under a mode that excludes them all.
    slots[spec.degenerateSlot] = slots[spec.degenerateSlot].map((p) => ({ ...p, exotic: true, hash: 4242 }));
  }
  const frag = spec.frag.slice();
  const minimums = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    if (!spec.minMask[s]) continue;
    let v = frag[s];
    for (let k = 0; k < NUM_SLOTS; k++) {
      const sl = slots[k];
      if (sl.length) v += sl[spec.minRef[k] % sl.length].stats[s];
    }
    // tunerBig: targets just above a real completion, so leaves need directionals.
    v += tunerBig ? Math.abs(spec.minDelta[s]) % 9 : spec.minDelta[s];
    minimums[s] = Math.max(0, Math.min(200, v));
  }
  let exoticMode = spec.exoticMode;
  if (spec.shape === "ineligibleSlot" && exoticMode !== "none") exoticMode = "specific";
  const exoticHashes =
    exoticMode === "specific"
      ? spec.shape === "ineligibleSlot"
        ? [1000]
        : spec.exoticSlot >= 0 && slots[spec.exoticSlot][0]?.hash !== undefined
          ? [slots[spec.exoticSlot][0].hash!]
          : []
      : undefined;
  const input: OptimizerInput = {
    slots,
    minimums,
    mods: { major: spec.major, minor: spec.minor },
    fragmentBonus: frag,
    allowTuning: spec.allowTuning,
    allowBalancedTuning: spec.allowBalanced,
    exotic: exoticHashes ? { mode: "specific", hashes: exoticHashes } : { mode: exoticMode },
    setRequirements: spec.setReq ? [{ setHash: spec.setReq.set, count: spec.setReq.count }] : [],
  };
  if (tunerBig) {
    input.allowTuning = true;
    input.setRequirements = [];
    input.exotic = { mode: "any" };
  }
  if (spec.power && !tunerBig) {
    input.powerRange = {
      min: 1990 + spec.power.lo,
      max: 1990 + spec.power.lo + spec.power.width,
      weapons: spec.power.weapons.map((w) => 1990 + w),
    };
  }
  // Huge pools exist to make the walk long (≥ 65,536 nodes): keep the default heap
  // (200) unless the spec asked for the extreme single-result heap.
  const maxResults =
    spec.shape === "huge" || spec.shape === "big" ? (spec.maxResults === 1 ? 1 : undefined) : spec.maxResults;
  if (maxResults !== undefined) input.maxResults = maxResults;
  return input;
}

// ---------------------------------------------------------------------------
// Controllable clock
// ---------------------------------------------------------------------------

export interface ClockPlan {
  /** Per-call increments, cycled (ms). */
  incs: number[];
  /**
   * Jumps: add `by` ms at a chosen call. Untargeted: call index floor(frac · refCalls).
   * Targeted (`site` set and present in the reference run): the floor(frac · n)-th of
   * the n reference calls made from that site — so a timeout can be aimed at e.g. the
   * probe tuner's onTick or the probe walk's node check.
   */
  jumps: { frac: number; by: number; site?: ClockSite }[];
}

export const arbClockPlan: fc.Arbitrary<ClockPlan> = fc.record({
  incs: fc.array(fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: fc.integer({ min: 0, max: 3 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 60 }) }), {
    minLength: 1,
    maxLength: 6,
  }),
  jumps: fc.array(
    fc.record({
      frac: fc.integer({ min: 0, max: 1050 }).map((x) => x / 1000),
      by: fc.oneof(fc.integer({ min: 1, max: 50 }), fc.constant(1e7), fc.constant(1e7)),
      site: fc.option(
        fc.constantFrom<ClockSite>("probe-tuner", "probe-walk", "probe-loop", "topn-tuner", "topn-walk"),
        { freq: 2, nil: undefined },
      ),
    }),
    { maxLength: 3 },
  ),
});

export type ClockSite =
  | "probe-tuner"
  | "topn-tuner"
  | "probe-walk"
  | "probe-loop"
  | "topn-walk"
  | "topn-other"
  | "ceilings-start"
  | "other";

/** Classify the production call site of a performance.now() call from its stack. */
export function classifySite(stack: string): ClockSite {
  if (stack.includes("tuning.ts")) return stack.includes("ceilings.ts") ? "probe-tuner" : "topn-tuner";
  const frames = stack.split("\n").filter((l) => /(ceilings|solve)\.ts/.test(l));
  if (frames.length === 0) return "other";
  if (frames[0].includes("ceilings.ts")) {
    if (frames.some((l) => /at (search|tick) /.test(l))) return "probe-walk";
    return "probe-loop";
  }
  if (frames.some((l) => /at recurse /.test(l))) return "topn-walk";
  return "topn-other";
}

/** Capture a deep stack (walk + tuner recursion is deeper than the default 10 frames). */
export function deepStack(): string {
  const prev = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const s = new Error().stack ?? "";
  Error.stackTraceLimit = prev;
  return s;
}

/**
 * Deterministic performance.now: per-call increments (cycled) plus jumps at call indices
 * `floor(frac · refCalls)`. With `refCalls` = the call count of the same run WITHOUT
 * jumps, a jump lands at an arbitrary point of that (deterministic) run's prefix.
 */
export class FakeClock {
  t = 0;
  calls = 0;
  /** Sites where a big (deadline-tripping) jump landed (for coverage stats). */
  jumpSites: ClockSite[] = [];
  /** Optional: histogram of every call site. */
  siteHist: Record<string, number> | null = null;
  /** Optional: the site of every call, in order (reference runs for targeting). */
  siteLog: ClockSite[] | null = null;
  private jumpAt = new Map<number, number>();
  constructor(
    private plan: ClockPlan | null,
    refCalls = 0,
    private recordSites = false,
    refSites: ClockSite[] | null = null,
  ) {
    if (plan) {
      for (const j of plan.jumps) {
        let at = Math.floor(j.frac * refCalls);
        if (j.site && refSites) {
          const idx: number[] = [];
          refSites.forEach((s, i) => s === j.site && idx.push(i));
          if (idx.length) at = idx[Math.min(idx.length - 1, Math.floor(j.frac * idx.length))];
        }
        this.jumpAt.set(at, (this.jumpAt.get(at) ?? 0) + j.by);
      }
    }
  }
  now = (): number => {
    const i = this.calls++;
    if (this.siteHist || this.siteLog) {
      const s = classifySite(deepStack());
      if (this.siteHist) this.siteHist[s] = (this.siteHist[s] ?? 0) + 1;
      this.siteLog?.push(s);
    }
    if (this.plan) {
      this.t += this.plan.incs[i % this.plan.incs.length];
      const j = this.jumpAt.get(i);
      if (j !== undefined) {
        this.t += j;
        if (this.recordSites && j >= 1e6) this.jumpSites.push(classifySite(deepStack()));
      }
    }
    return this.t;
  };
}

/** The plan with its jumps removed (for measuring the un-jumped run's call count). */
export const withoutJumps = (p: ClockPlan): ClockPlan => ({ incs: p.incs, jumps: [] });
