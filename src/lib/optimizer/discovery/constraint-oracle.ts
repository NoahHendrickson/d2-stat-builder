/**
 * Discovery harness: an independent exhaustive oracle for the optimizer that ALSO models
 * the constraint dimensions completeness-oracle.test.ts never generates — power ranges
 * (with weapons), several set requirements (overlapping / duplicated / unreachable), and
 * "specific" exotics with several hashes — plus generators that deliberately produce
 * stat-identical pieces differing only in a constraint-relevant field (setHash, power,
 * hash, artifice, tuning, id), which is exactly what bounds.ts `dedupe` merges.
 *
 * The oracle shares nothing with production pruning (no dedupe, no suffix bounds, no
 * power tracker, no assignMods / directionalsBranchable): every combination × every
 * reachable tuning delta × every mod covering, written from the game rules alone. It
 * memoizes only pure arithmetic (reachable tuning-delta sets, coverings by deficit).
 *
 * The production-tuner enumerations (`policyTotals`) are deliberately NOT independent:
 * they run the production leaf tuner over every legal combo, once over buildSlots' deduped
 * pool and once over the raw pieces, so the top-N walk's pruning (and dedupe itself) can
 * be checked for invisibility against the policy total.
 */
import fc from "fast-check";
import { NUM_SLOTS, NUM_STATS, clamp } from "../floors";
import { buildSlots } from "../bounds";
import { createTuningSearcher, makeInternalPiece, type InternalPiece } from "../tuning";
import type {
  ExoticConstraint,
  OptimizerInput,
  OptimizerLoadout,
  OptimizerPiece,
  PieceTuning,
  PowerRange,
} from "../types";

// ---------------------------------------------------------------------------
// Rules, written independently
// ---------------------------------------------------------------------------

/** Gear power from the rules: floor(mean) over known-power pieces + weapons; null if none. */
export function oraclePower(pieces: readonly OptimizerPiece[], weapons: readonly number[] = []): number | null {
  const known: number[] = [...weapons];
  for (const p of pieces) if (p.power !== undefined) known.push(p.power);
  if (known.length === 0) return null;
  const s = known.reduce((a, b) => a + b, 0);
  return Math.floor(s / known.length);
}

export function powerOk(pieces: readonly OptimizerPiece[], range: PowerRange | undefined): boolean {
  if (!range) return true;
  const pw = oraclePower(pieces, range.weapons ?? []);
  if (pw === null) return true;
  return pw >= range.min && pw <= range.max;
}

export function exoticEligible(p: OptimizerPiece, ex: ExoticConstraint | undefined): boolean {
  if (!p.exotic) return true;
  const mode = ex?.mode ?? "any";
  if (mode === "none") return false;
  if (mode === "specific") return p.hash !== undefined && (ex?.hashes ?? []).includes(p.hash);
  return true;
}

/** Combo-level legality (everything except the stat minimums). */
export function comboLegal(chosen: readonly OptimizerPiece[], input: OptimizerInput): boolean {
  let exotics = 0;
  for (const p of chosen) {
    if (!exoticEligible(p, input.exotic)) return false;
    if (p.exotic) exotics++;
  }
  if (exotics > 1) return false;
  const mode = input.exotic?.mode ?? "any";
  if ((mode === "require" || mode === "specific") && exotics !== 1) return false;
  for (const r of input.setRequirements ?? []) {
    let c = 0;
    for (const p of chosen) if (p.setHash === r.setHash) c++;
    if (c < r.count) return false;
  }
  return powerOk(chosen, input.powerRange);
}

/** Every tuning delta a piece may take, from the rules. */
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

/** Reachable summed tuning deltas for a combo (Minkowski sum, deduplicated). */
function reachableDeltas(chosen: readonly OptimizerPiece[], input: OptimizerInput): number[][] {
  let acc = new Map<string, number[]>([["0,0,0,0,0,0", [0, 0, 0, 0, 0, 0]]]);
  for (const p of chosen) {
    const vecs = oracleTuneVecs(p, input);
    if (vecs.length === 1) continue;
    const next = new Map<string, number[]>();
    for (const a of acc.values()) {
      for (const v of vecs) {
        const s = a.map((x, i) => x + v[i]);
        const k = s.join(",");
        if (!next.has(k)) next.set(k, s);
      }
    }
    acc = next;
  }
  return [...acc.values()];
}

/**
 * Every covering of `deficits` with the budgets: whether one exists, and the best
 * leftover mod points (majors ×10 + minors ×5 + artifice ×3) any covering leaves.
 */
function coverings(
  deficits: readonly number[],
  major: number,
  minor: number,
  art: number,
): { feasible: boolean; bestLeftoverPoints: number } {
  let feasible = false;
  let best = -1;
  const rec = (s: number, M: number, m: number, A: number): void => {
    if (s === NUM_STATS) {
      feasible = true;
      const leftover = M * 10 + m * 5 + A * 3;
      if (leftover > best) best = leftover;
      return;
    }
    const d = deficits[s];
    if (d <= 0) {
      rec(s + 1, M, m, A);
      return;
    }
    for (let a = 0; a <= M; a++)
      for (let b = 0; b <= m; b++)
        for (let c = 0; c <= A; c++) if (a * 10 + b * 5 + c * 3 >= d) rec(s + 1, M - a, m - b, A - c);
  };
  rec(0, major, minor, art);
  return { feasible, bestLeftoverPoints: best };
}

export interface OracleResult {
  feasible: boolean;
  /** Per stat: max final value subject to the OTHER five minimums (own ignored). 0 if none. */
  ceilings: number[];
  /** Upper bound on Σ clamp(final) over legal assignments (mods placed anywhere). */
  bestTotalUpper: number;
  /** Combos passing everything but the stat minimums. */
  legalCombos: number;
  /** Combos rejected ONLY by the power range (exotic + sets fine). */
  powerRejected: number;
  /** Combos whose power-range verdict flips when the weapons are dropped. */
  weaponFlips: number;
  /** Combos passing the range with a null gear power. */
  nullPowerCombos: number;
  /** Feasible legal combos (meet minimums). */
  feasibleCombos: number;
}

export function oracle(input: OptimizerInput): OracleResult {
  const mins = input.minimums;
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  const res: OracleResult = {
    feasible: false,
    ceilings: new Array(NUM_STATS).fill(0),
    bestTotalUpper: 0,
    legalCombos: 0,
    powerRejected: 0,
    weaponFlips: 0,
    nullPowerCombos: 0,
    feasibleCombos: 0,
  };
  const covMemo = new Map<string, { feasible: boolean; bestLeftoverPoints: number }>();
  const cov = (d: number[], art: number) => {
    const k = `${art}|${d.join(",")}`;
    let r = covMemo.get(k);
    if (!r) {
      r = coverings(d, major, minor, art);
      covMemo.set(k, r);
    }
    return r;
  };
  const chosen: OptimizerPiece[] = new Array(NUM_SLOTS);
  const deficits = new Array(NUM_STATS).fill(0);
  const evalCombo = (): void => {
    const range = input.powerRange;
    const noPower: OptimizerInput = { ...input, powerRange: undefined };
    if (range) {
      const withW = powerOk(chosen, range);
      const noW = powerOk(chosen, { ...range, weapons: [] });
      if (withW !== noW && comboLegal(chosen, noPower)) res.weaponFlips++;
      if (!withW && comboLegal(chosen, noPower)) res.powerRejected++;
    }
    if (!comboLegal(chosen, input)) return;
    res.legalCombos++;
    if (range && oraclePower(chosen, range.weapons ?? []) === null) res.nullPowerCombos++;
    let art = 0;
    for (const p of chosen) if (p.artifice) art++;
    const base = new Array(NUM_STATS).fill(0);
    for (let s = 0; s < NUM_STATS; s++) {
      base[s] = frag[s];
      for (const p of chosen) base[s] += p.stats[s];
    }
    let comboFeasible = false;
    for (const delta of reachableDeltas(chosen, input)) {
      const pre = base.map((b, s) => b + delta[s]);
      for (let s = 0; s < NUM_STATS; s++) deficits[s] = mins[s] > 0 && pre[s] < mins[s] ? mins[s] - pre[s] : 0;
      const all = cov(deficits, art);
      if (all.feasible) {
        comboFeasible = true;
        let total = 0;
        let headroom = 0;
        for (let s = 0; s < NUM_STATS; s++) {
          total += clamp(pre[s]);
          headroom += 200 - clamp(pre[s]);
        }
        total += Math.min(headroom, major * 10 + minor * 5 + art * 3);
        if (total > res.bestTotalUpper) res.bestTotalUpper = total;
      }
      for (let t = 0; t < NUM_STATS; t++) {
        const saved = deficits[t];
        deficits[t] = 0;
        const c = cov(deficits, art);
        deficits[t] = saved;
        if (!c.feasible) continue;
        const v = clamp(pre[t] + c.bestLeftoverPoints);
        if (v > res.ceilings[t]) res.ceilings[t] = v;
      }
    }
    if (comboFeasible) {
      res.feasible = true;
      res.feasibleCombos++;
    }
  };
  const rec = (k: number): void => {
    if (k === NUM_SLOTS) {
      evalCombo();
      return;
    }
    for (const p of input.slots[k]) {
      chosen[k] = p;
      rec(k + 1);
    }
  };
  rec(0);
  return res;
}

// ---------------------------------------------------------------------------
// Production-tuner enumerations (policy totals of ALL legal combos)
// ---------------------------------------------------------------------------

/**
 * Policy totals (production tuner, maximize mode) of every legal combo over `slots`,
 * where legality uses the INDEPENDENT rules above. `slots` is either buildSlots' deduped
 * pool or the raw pieces wrapped by makeInternalPiece. Returns totals sorted descending.
 */
export function policyTotals(input: OptimizerInput, slots: InternalPiece[][]): number[] {
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const tuner = createTuningSearcher(frag, input.mods ?? { major: 0, minor: 0 });
  const out: number[] = [];
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const rec = (k: number): void => {
    if (k === NUM_SLOTS) {
      // InternalPiece carries every field comboLegal reads (exotic/hash/setHash/power).
      if (!comboLegal(chosen as unknown as OptimizerPiece[], input)) return;
      const sum = new Array(NUM_STATS).fill(0);
      for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
      const r = tuner(chosen, sum, input.minimums, "maximize");
      if (r) out.push(r.total);
      return;
    }
    for (const p of slots[k]) {
      chosen[k] = p;
      rec(k + 1);
    }
  };
  rec(0);
  return out.sort((a, b) => b - a);
}

export const dedupedPolicyTotals = (input: OptimizerInput): number[] => policyTotals(input, buildSlots(input));

export function rawPolicyTotals(input: OptimizerInput): number[] {
  const allowTuning = input.allowTuning ?? true;
  const allowBalanced = input.allowBalancedTuning ?? true;
  const slots = input.slots.map((s) =>
    s.filter((p) => exoticEligible(p, input.exotic)).map((p) => makeInternalPiece(p, allowTuning, allowBalanced, input.minimums)),
  );
  return policyTotals(input, slots);
}

// ---------------------------------------------------------------------------
// Legality + reconstruction of a returned build (extended with power / sets / specific)
// ---------------------------------------------------------------------------

/** Returns a list of violation strings (empty = legal). Pure, no expect(). */
export function loadoutViolations(lo: OptimizerLoadout, input: OptimizerInput): string[] {
  const errs: string[] = [];
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const pieces: OptimizerPiece[] = [];
  for (let k = 0; k < NUM_SLOTS; k++) {
    const p = input.slots[k].find((q) => q.id === lo.pieceIds[k]);
    if (!p) {
      errs.push(`piece ${lo.pieceIds[k]} not in slot ${k}`);
      return errs;
    }
    pieces.push(p);
  }
  const exotics = pieces.filter((p) => p.exotic);
  if (exotics.length > 1) errs.push("more than one exotic");
  const mode = input.exotic?.mode ?? "any";
  if (mode === "none" && exotics.length) errs.push("exotic under none");
  if ((mode === "require" || mode === "specific") && exotics.length !== 1) errs.push("exotic count != 1");
  if (mode === "specific" && exotics.length === 1 && !(input.exotic?.hashes ?? []).includes(exotics[0].hash as number))
    errs.push(`specific exotic hash ${exotics[0].hash} not in ${input.exotic?.hashes}`);
  if (lo.exotic !== exotics.length > 0) errs.push("exotic flag wrong");
  for (const r of input.setRequirements ?? []) {
    const c = pieces.filter((p) => p.setHash === r.setHash).length;
    if (c < r.count) errs.push(`set ${r.setHash} has ${c} < ${r.count}`);
  }
  const weapons = input.powerRange?.weapons ?? [];
  const truePower = oraclePower(pieces, weapons);
  if (lo.power !== truePower) errs.push(`power field ${lo.power} != actual ${truePower}`);
  if (!powerOk(pieces, input.powerRange)) errs.push(`power ${truePower} outside ${JSON.stringify(input.powerRange)}`);
  // Tuning legality.
  const tuningSum = [0, 0, 0, 0, 0, 0];
  lo.tuning.forEach((t, k) => {
    const p = pieces[k];
    if (t === null) return;
    if (!p.tuning) errs.push(`untunable ${p.id} tuned`);
    if ((input.allowTuning ?? true) === false) errs.push("tuned with tuning off");
    if (!p.tuning) return;
    if (t.kind === "balanced") {
      if ((input.allowBalancedTuning ?? true) === false) errs.push("balanced while disallowed");
      for (const s of p.tuning.offStats) tuningSum[s] += 1;
    } else {
      if (p.tuning.directional === false) errs.push(`directional on balanced-only ${p.id}`);
      if (!p.exotic && t.plus !== p.tuning.tuned) errs.push(`legendary ${p.id} +5 off its tuned stat`);
      if (t.minus === t.plus) errs.push("plus == minus");
      tuningSum[t.plus] += 5;
      tuningSum[t.minus] -= 5;
    }
  });
  if (lo.tuningBonus.join() !== tuningSum.join()) errs.push(`tuningBonus ${lo.tuningBonus} != ${tuningSum}`);
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  if (lo.modsUsed.major > major || lo.modsUsed.minor > minor) errs.push("mod budget exceeded");
  if (lo.modBonus.reduce((a, b) => a + b, 0) > lo.modsUsed.major * 10 + lo.modsUsed.minor * 5) errs.push("modBonus > mods used");
  if (lo.modBonus.some((v) => v < 0)) errs.push("negative modBonus");
  const artPieces = pieces.filter((p) => p.artifice).length;
  const artPoints = lo.artificeBonus.reduce((a, b) => a + b, 0);
  if (artPoints % 3 !== 0 || artPoints / 3 > artPieces) errs.push("artifice budget");
  let total = 0;
  for (let s = 0; s < NUM_STATS; s++) {
    let base = frag[s];
    for (const p of pieces) base += p.stats[s];
    const v = clamp(base + lo.tuningBonus[s] + lo.modBonus[s] + lo.artificeBonus[s]);
    if (lo.stats[s] !== v) errs.push(`stat ${s} ${lo.stats[s]} != reconstructed ${v}`);
    if (lo.stats[s] < Math.min(input.minimums[s], 200)) errs.push(`stat ${s} below min`);
    total += v;
  }
  if (lo.total !== total) errs.push(`total ${lo.total} != ${total}`);
  return errs;
}

// ---------------------------------------------------------------------------
// Generators (fast-check): collision-heavy pools + twins + interacting constraints
// ---------------------------------------------------------------------------

export const POWER_DOMAIN = [8, 9, 10, 11, 12] as const;
export const SET_DOMAIN = [0, 7, 8] as const;
/** Set domain that avoids hash 0 (looks past finding F2: setHash 0 ≡ undefined in dedupe). */
export const SET_DOMAIN_NO0 = [6, 7, 8] as const;
export const HASH_DOMAIN = [1000, 1001, 1002] as const;
/** Cap on tunable pieces per query so the exhaustive tuning enumeration stays small. */
const MAX_TUNABLE = 3;

/** Per-piece power roll: below the query's undefCut → undefined, 18–19 → 0, else `val`. */
type PowerSpec = { roll: number; val: number };
const powerSpecArb: fc.Arbitrary<PowerSpec> = fc.record({
  roll: fc.nat({ max: 19 }),
  val: fc.constantFrom(...POWER_DOMAIN),
});
const powerOf = (s: PowerSpec, undefCut: number): number | undefined =>
  s.roll < undefCut ? undefined : s.roll >= 18 ? 0 : s.val;

const statVecArb = (nonNegative: boolean) =>
  fc.array(nonNegative ? fc.constantFrom(5, 10, 20, 30) : fc.constantFrom(0, 5, 10, 20, 30), {
    minLength: 6,
    maxLength: 6,
  });

const tuningArb: fc.Arbitrary<PieceTuning | undefined> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  {
    weight: 2,
    arbitrary: fc
      .record({
        off: fc.shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 3, maxLength: 3 }),
        tunedPick: fc.nat({ max: 2 }),
        balancedOnly: fc.boolean(),
      })
      .map(({ off, tunedPick, balancedOnly }) => {
        const offStats = [...off].sort((a, b) => a - b);
        const t: PieceTuning = { tuned: offStats[tunedPick], offStats };
        if (balancedOnly) t.directional = false;
        return t;
      }),
  },
);

interface PieceSpec {
  tpl: number;
  exoticRoll: number;
  hash: number | undefined;
  setHash: number | undefined;
  power: PowerSpec;
  artifice: boolean;
  tuning: PieceTuning | undefined;
}

const pieceSpecArb = (setDomain: readonly number[]): fc.Arbitrary<PieceSpec> => fc.record({
  tpl: fc.nat({ max: 2 }),
  exoticRoll: fc.nat({ max: 9 }),
  hash: fc.option(fc.constantFrom(...HASH_DOMAIN), { nil: undefined, freq: 5 }),
  setHash: fc.option(fc.constantFrom(...setDomain), { nil: undefined, freq: 3 }),
  power: powerSpecArb,
  artifice: fc.boolean(),
  tuning: tuningArb,
});

/** Which field a twin changes (everything else copied, stats identical). */
export const TWIN_FIELDS = ["setHash", "power", "hash", "artifice", "tuned", "offStats", "directional", "id"] as const;
export type TwinField = (typeof TWIN_FIELDS)[number];

interface TwinSpec {
  slot: number;
  src: number;
  field: TwinField;
  pick: number;
}
const twinSpecArb: fc.Arbitrary<TwinSpec> = fc.record({
  slot: fc.nat({ max: NUM_SLOTS - 1 }),
  src: fc.nat({ max: 3 }),
  field: fc.constantFrom(...TWIN_FIELDS),
  pick: fc.nat({ max: 5 }),
});

export interface GenMeta {
  /** Twins that were actually created (field changed to a DIFFERENT value). */
  twins: { slot: number; field: TwinField; a: OptimizerPiece; b: OptimizerPiece }[];
}

export interface GenCase {
  input: OptimizerInput;
  meta: GenMeta;
}

function makeTwin(
  p: OptimizerPiece,
  field: TwinField,
  pick: number,
  id: string,
  setDomain: readonly number[],
): OptimizerPiece | null {
  const q: OptimizerPiece = {
    ...p,
    id,
    stats: p.stats.slice(),
    tuning: p.tuning ? { ...p.tuning, offStats: p.tuning.offStats.slice() } : undefined,
  };
  switch (field) {
    case "setHash": {
      const opts = [undefined, ...setDomain].filter((v) => v !== p.setHash);
      q.setHash = opts[pick % opts.length];
      break;
    }
    case "power": {
      const opts = [undefined, 0, ...POWER_DOMAIN].filter((v) => v !== p.power);
      q.power = opts[pick % opts.length];
      break;
    }
    case "hash": {
      const opts = [undefined, ...HASH_DOMAIN].filter((v) => v !== p.hash);
      q.hash = opts[pick % opts.length];
      break;
    }
    case "artifice":
      q.artifice = p.artifice ? undefined : true;
      break;
    case "tuned": {
      if (!q.tuning) return null;
      const opts = q.tuning.offStats.filter((s) => s !== q.tuning!.tuned);
      q.tuning.tuned = opts[pick % opts.length];
      break;
    }
    case "offStats": {
      if (!q.tuning) return null;
      // A different 3-subset that still contains the tuned stat.
      const rest = [0, 1, 2, 3, 4, 5].filter((s) => s !== q.tuning!.tuned);
      const a = rest[pick % rest.length];
      const b = rest[(pick + 2) % rest.length];
      const off = [...new Set([q.tuning.tuned, a, b])].sort((x, y) => x - y);
      if (off.length !== 3 || off.join() === p.tuning!.offStats.join()) return null;
      q.tuning.offStats = off;
      break;
    }
    case "directional":
      if (!q.tuning) return null;
      if (q.tuning.directional === false) delete q.tuning.directional;
      else q.tuning.directional = false;
      break;
    case "id":
      break;
  }
  return q;
}

export interface CaseOptions {
  /**
   * No pre-clamp negatives anywhere: fragments ≥ 0 and every roll ≥ 5 (so even four −5
   * directionals keep a stat ≥ 5·5 − 20). Lets the survey look past finding F1
   * (clamped-stat floor harvest), which needs a stat below 0 before clamping.
   */
  nonNegative?: boolean;
  /** Never use set hash 0 (looks past finding F2). */
  noSetHash0?: boolean;
  /** Exotics never carry `directional: false` (looks past finding F3). */
  noExoticBalancedOnly?: boolean;
  /** Base pieces per slot (before twins); default 3. Larger pools make top-N pruning bite. */
  maxPerSlot?: number;
}

const setDomain = (opts: CaseOptions): readonly number[] => (opts.noSetHash0 ? SET_DOMAIN_NO0 : SET_DOMAIN);

/** The full query arbitrary. */
export const makeCaseArb = (opts: CaseOptions = {}): fc.Arbitrary<GenCase> => fc
  .record({
    templates: fc.array(statVecArb(!!opts.nonNegative), { minLength: 1, maxLength: 3 }),
    // Per query: how many of 20 power rolls mean "unknown" (mostly known … mostly unknown).
    undefCut: fc.constantFrom(2, 4, 8, 18),
    slots: fc.array(fc.array(pieceSpecArb(setDomain(opts)), { minLength: 1, maxLength: opts.maxPerSlot ?? 3 }), {
      minLength: NUM_SLOTS,
      maxLength: NUM_SLOTS,
    }),
    exoticRate: fc.constantFrom(0, 2, 4),
    twins: fc.array(twinSpecArb, { minLength: 0, maxLength: 4 }),
    mods: fc.record({ major: fc.nat({ max: 2 }), minor: fc.nat({ max: 2 }) }),
    frag: fc.array(opts.nonNegative ? fc.constantFrom(0, 0, 0, 10, 20) : fc.constantFrom(0, 0, 0, -10, 10, -20, 20), {
      minLength: 6,
      maxLength: 6,
    }),
    allowTuningWeight: fc.nat({ max: 9 }),
    allowBalanced: fc.nat({ max: 4 }),
    minsRef: fc.array(fc.nat({ max: 3 }), { minLength: NUM_SLOTS, maxLength: NUM_SLOTS }),
    minsOn: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    minsOff: fc.array(fc.integer({ min: -8, max: 12 }), { minLength: 6, maxLength: 6 }),
    power: fc.option(
      fc.record({
        // Range placed relative to a reference combo power so it straddles real loadouts.
        offMin: fc.integer({ min: -2, max: 1 }),
        width: fc.constantFrom(-1, 0, 0, 1, 1, 2, 3),
        weapons: fc.array(fc.constantFrom(8, 9, 10, 11, 12, 13, 14, 0, 20), { minLength: 0, maxLength: 3 }),
      }),
      { nil: undefined, freq: 2 },
    ),
    setReqs: fc.array(
      fc.record({
        // 9 is never on any piece: an unreachable requirement.
        setHash: fc.constantFrom(...setDomain(opts), ...setDomain(opts), 9),
        count: fc.constantFrom(1, 1, 2, 2, 2, 3, 4, 5),
      }),
      { minLength: 0, maxLength: 3 },
    ).chain((r) => fc.nat({ max: 2 }).map((drop) => (drop === 0 ? r : r.slice(0, drop - 1)))),
    exoticMode: fc.constantFrom("any", "any", "none", "require", "specific", "specific") as fc.Arbitrary<
      ExoticConstraint["mode"]
    >,
    specificHashes: fc.subarray([...HASH_DOMAIN, 999]),
  })
  .map((g): GenCase => {
    let n = 0;
    const tpl = (i: number) => g.templates[i % g.templates.length];
    const slots: OptimizerPiece[][] = g.slots.map((specs) =>
      specs.map((sp): OptimizerPiece => {
        // Exotic with probability exoticRate/10 per piece (0 = an exotic-free pool).
        const exotic = sp.exoticRoll < g.exoticRate;
        return {
          id: `p${n++}`,
          stats: tpl(sp.tpl).slice(),
          exotic,
          hash: exotic ? sp.hash : undefined,
          setHash: sp.setHash,
          power: powerOf(sp.power, g.undefCut),
          artifice: sp.artifice && !sp.tuning ? true : undefined,
          tuning: sp.tuning ? { ...sp.tuning, offStats: sp.tuning.offStats.slice() } : undefined,
        };
      }),
    );
    // Cap tunables BEFORE twinning (keeps the exhaustive tuning enumeration tractable
    // without silently erasing a tuning-field twin's difference).
    let tunables = 0;
    for (const slot of slots)
      for (const p of slot)
        if (p.tuning) {
          if (tunables >= MAX_TUNABLE) p.tuning = undefined;
          else tunables++;
        }
    const meta: GenMeta = { twins: [] };
    for (const t of g.twins) {
      const slot = slots[t.slot];
      const src = slot[t.src % slot.length];
      const tw = makeTwin(src, t.field, t.pick, `p${n++}`, setDomain(opts));
      if (!tw) continue;
      slot.push(tw);
      meta.twins.push({ slot: t.slot, field: t.field, a: src, b: tw });
    }
    if (opts.noExoticBalancedOnly) {
      for (const slot of slots) for (const p of slot) if (p.exotic && p.tuning) delete p.tuning.directional;
      meta.twins = meta.twins.filter((t) => !(t.field === "directional" && t.a.exotic));
    }
    const frag = g.frag;
    const ref = slots.map((slot, k) => slot[g.minsRef[k] % slot.length]);
    const mins = new Array(NUM_STATS).fill(0);
    for (let s = 0; s < NUM_STATS; s++) {
      if (!g.minsOn[s]) continue;
      let v = frag[s];
      for (const p of ref) v += p.stats[s];
      mins[s] = Math.max(0, Math.min(200, v + g.minsOff[s]));
    }
    let powerRange: PowerRange | undefined;
    if (g.power) {
      const center = oraclePower(ref, g.power.weapons) ?? 10;
      const min = center + g.power.offMin;
      powerRange = { min, max: min + g.power.width, ...(g.power.weapons.length ? { weapons: g.power.weapons } : {}) };
    }
    const exotic: ExoticConstraint =
      g.exoticMode === "specific" ? { mode: "specific", hashes: g.specificHashes } : { mode: g.exoticMode };
    return {
      input: {
        slots,
        minimums: mins,
        mods: g.mods,
        fragmentBonus: frag,
        allowTuning: g.allowTuningWeight < 9,
        allowBalancedTuning: g.allowBalanced < 4,
        exotic,
        setRequirements: g.setReqs,
        ...(powerRange ? { powerRange } : {}),
      },
      meta,
    };
  });

// ---------------------------------------------------------------------------
// Coverage classification
// ---------------------------------------------------------------------------

const sameStats = (a: OptimizerPiece, b: OptimizerPiece) => a.stats.join() === b.stats.join();

/** Labels describing which interacting-operand classes a case actually exercises. */
export function classify(c: GenCase, truth: OracleResult): string[] {
  const { input, meta } = c;
  const L: string[] = [];
  const reqs = input.setRequirements ?? [];
  const pr = input.powerRange;
  L.push(truth.feasible ? "feasible" : "infeasible");
  if (pr) {
    L.push("power:range");
    if (pr.min > pr.max) L.push("power:min>max");
    if (pr.min === pr.max) L.push("power:single");
    if (pr.weapons?.length) L.push("power:weapons");
    if (truth.powerRejected > 0 && truth.legalCombos > 0) L.push("power:binding(straddle)");
    if (truth.powerRejected > 0 && truth.legalCombos === 0) L.push("power:kills-all");
    if (truth.weaponFlips > 0) L.push("power:weapon-flips-verdict");
    if (truth.nullPowerCombos > 0) L.push("power:null-power-legal");
    const pieces = input.slots.flat();
    if (pieces.some((p) => p.power === 0)) L.push("power:zero-piece");
    if (pieces.some((p) => p.power === undefined)) L.push("power:undef-piece");
    const ps = pieces.map((p) => p.power).filter((v): v is number => v !== undefined);
    if (ps.some((v) => v === pr.min || v === pr.max)) L.push("power:piece-at-boundary");
  }
  L.push(`sets:${reqs.length}`);
  if (reqs.length) {
    const hs = reqs.map((r) => r.setHash);
    if (new Set(hs).size < hs.length) L.push("sets:same-hash-twice");
    if (reqs.some((r) => r.count > 5) || reqs.reduce((a, r) => a + r.count, 0) > 5) L.push("sets:overcommitted");
    if (reqs.some((r) => r.setHash === 0)) L.push("sets:hash0-required");
  }
  if (input.exotic?.mode === "specific") L.push(`exotic:specific(${input.exotic.hashes?.length ?? 0})`);
  else L.push(`exotic:${input.exotic?.mode ?? "any"}`);
  for (const t of meta.twins) {
    L.push(`twin:${t.field}`);
    if (t.field === "setHash" && reqs.some((r) => (r.setHash === t.a.setHash) !== (r.setHash === t.b.setHash)))
      L.push("twin:setHash-req-splits-pair");
    if (t.field === "setHash" && (t.a.setHash ?? 0) === (t.b.setHash ?? 0)) L.push("twin:setHash-0-vs-undef");
    if (t.field === "power" && pr) {
      const pa = t.a.power, pb = t.b.power;
      L.push("twin:power-under-range");
      if ((pa === 0 && pb === undefined) || (pa === undefined && pb === 0)) L.push("twin:power-0-vs-undef");
      const inR = (v: number | undefined) => v !== undefined && v >= pr.min && v <= pr.max;
      if (inR(pa) !== inR(pb)) L.push("twin:power-straddles-range");
    }
    if (t.field === "hash" && t.a.exotic) {
      L.push("twin:exotic-hash");
      if (input.exotic?.mode === "specific") {
        const h = input.exotic.hashes ?? [];
        if (h.includes(t.a.hash as number) !== h.includes(t.b.hash as number)) L.push("twin:hash-specific-splits-pair");
      }
    }
    if (t.field === "directional" && t.a.exotic) L.push("twin:exotic-directional-flag");
  }
  // Stat collisions within a slot (independent of twins).
  for (const slot of input.slots)
    for (let i = 0; i < slot.length; i++)
      for (let j = i + 1; j < slot.length; j++) if (sameStats(slot[i], slot[j])) L.push("collision:same-stats-in-slot");
  return [...new Set(L)];
}
