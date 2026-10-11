/**
 * Discovery harness for cross-edit ceiling carryover (carryover.ts) and the worker solve
 * session (session.ts): an independent exhaustive oracle (adapted from
 * completeness-oracle.test.ts — extended with power ranges, Balanced-only tunables,
 * multiple set requirements, and ceilings defined for INFEASIBLE queries too), a tiny-pool
 * query generator, an edit generator covering every OptimizerInput field, and a stubbed
 * performance.now clock.
 *
 * Nothing here imports production solver code: the oracle is written from the game rules.
 */
import { vi } from "vitest";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerPiece,
  PowerRange,
  SetRequirement,
} from "../types";

export const NS = 6;
export const NSLOT = 5;
const CAP = 200;
const clamp = (v: number) => (v < 0 ? 0 : v > CAP ? CAP : v);

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

export type Rnd = () => number;
export function rng(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ri = (r: Rnd, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = <T>(r: Rnd, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const chance = (r: Rnd, p: number) => r() < p;

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

function tuneVecs(p: OptimizerPiece, input: OptimizerInput): number[][] {
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
    for (let minus = 0; minus < NS; minus++) {
      if (minus === plus) continue;
      const v = zero.slice();
      v[plus] += 5;
      v[minus] -= 5;
      out.push(v);
    }
  }
  return out;
}

function exoticAllowed(p: OptimizerPiece, input: OptimizerInput): boolean {
  if (!p.exotic) return true;
  const mode = input.exotic?.mode ?? "any";
  if (mode === "none") return false;
  if (mode === "specific") return p.hash !== undefined && !!input.exotic?.hashes?.includes(p.hash);
  return true;
}

/** Gear power the game way: floor(mean) over known-power pieces + weapons; null if none. */
export function oraclePower(pieces: OptimizerPiece[], range: PowerRange | undefined): number | null {
  const items: number[] = [...(range?.weapons ?? [])];
  for (const p of pieces) if (p.power !== undefined) items.push(p.power);
  if (items.length === 0) return null;
  return Math.floor(items.reduce((a, b) => a + b, 0) / items.length);
}

export interface Truth {
  feasible: boolean;
  /** Per stat: max final value subject to the OTHER five minimums (own ignored); 0 if none. */
  ceilings: number[];
  /** Number of legal piece combos (before minimums). */
  legalCombos: number;
}

const ENC = 51;
const OFF = 25;
function enc(v: number[]): number {
  let x = 0;
  for (let s = 0; s < NS; s++) x = x * ENC + (v[s] + OFF);
  return x;
}
function dec(x: number): number[] {
  const v = new Array(NS);
  for (let s = NS - 1; s >= 0; s--) {
    v[s] = (x % ENC) - OFF;
    x = Math.floor(x / ENC);
  }
  return v;
}

export function oracle(input: OptimizerInput): Truth {
  const mins = input.minimums;
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const mode = input.exotic?.mode ?? "any";
  const needExotic = mode === "require" || mode === "specific";
  const res: Truth = { feasible: false, ceilings: new Array(NS).fill(0), legalCombos: 0 };
  if (input.slots.length !== NSLOT) return res;

  // coverings memo: key = deficits + art → best leftover points (-1 = infeasible)
  const memo = new Map<string, number>();
  const cover = (def: number[], art: number): number => {
    const key = def.join(",") + "|" + art;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = -1;
    const rec = (s: number, M: number, m: number, A: number): void => {
      if (s === NS) {
        const left = M * 10 + m * 5 + A * 3;
        if (left > best) best = left;
        return;
      }
      const d = def[s];
      if (d <= 0) return rec(s + 1, M, m, A);
      for (let a = 0; a <= M; a++)
        for (let b = 0; b <= m; b++)
          for (let c = 0; c <= A; c++)
            if (a * 10 + b * 5 + c * 3 >= d) rec(s + 1, M - a, m - b, A - c);
    };
    rec(0, major, minor, art);
    memo.set(key, best);
    return best;
  };

  const chosen: OptimizerPiece[] = new Array(NSLOT);
  const evalCombo = () => {
    let exotics = 0;
    let art = 0;
    for (const p of chosen) {
      if (p.exotic) exotics++;
      if (p.artifice) art++;
    }
    if (exotics > 1) return;
    if (needExotic && exotics !== 1) return;
    for (const r of reqs) if (chosen.filter((p) => p.setHash === r.setHash).length < r.count) return;
    if (input.powerRange) {
      const pw = oraclePower(chosen, input.powerRange);
      if (pw !== null && (pw < input.powerRange.min || pw > input.powerRange.max)) return;
    }
    res.legalCombos++;
    // Distinct tuning sums.
    let sums = new Set<number>([enc([0, 0, 0, 0, 0, 0])]);
    for (const p of chosen) {
      const vs = tuneVecs(p, input);
      const next = new Set<number>();
      for (const x of sums) {
        const base = dec(x);
        for (const v of vs) next.add(enc(base.map((b, s) => b + v[s])));
      }
      sums = next;
    }
    const raw = new Array(NS).fill(0);
    for (let s = 0; s < NS; s++) {
      raw[s] = frag[s];
      for (const p of chosen) raw[s] += p.stats[s];
    }
    const def = new Array(NS).fill(0);
    for (const x of sums) {
      const tv = dec(x);
      const pre = raw.map((v, s) => v + tv[s]);
      for (let s = 0; s < NS; s++) def[s] = mins[s] > 0 && pre[s] < mins[s] ? mins[s] - pre[s] : 0;
      if (!res.feasible && cover(def, art) >= 0) res.feasible = true;
      for (let t = 0; t < NS; t++) {
        const saved = def[t];
        def[t] = 0;
        const left = cover(def, art);
        def[t] = saved;
        if (left < 0) continue;
        const v = clamp(pre[t] + left);
        if (v > res.ceilings[t]) res.ceilings[t] = v;
      }
    }
  };
  const recSlot = (k: number) => {
    if (k === NSLOT) return evalCombo();
    for (const p of input.slots[k]) {
      if (!exoticAllowed(p, input)) continue;
      chosen[k] = p;
      recSlot(k + 1);
    }
  };
  recSlot(0);
  return res;
}

// ---------------------------------------------------------------------------
// Legality of a returned build (abridged checkLoadout, returns an error string)
// ---------------------------------------------------------------------------

export function loadoutError(lo: OptimizerLoadout, input: OptimizerInput): string | null {
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const pieces: OptimizerPiece[] = [];
  for (let k = 0; k < NSLOT; k++) {
    const p = input.slots[k].find((q) => q.id === lo.pieceIds[k]);
    if (!p) return `piece ${lo.pieceIds[k]} not in slot ${k}`;
    pieces.push(p);
  }
  if (pieces.filter((p) => p.exotic).length > 1) return "2 exotics";
  for (const p of pieces) if (!exoticAllowed(p, input)) return "exotic not allowed";
  const mode = input.exotic?.mode ?? "any";
  if ((mode === "require" || mode === "specific") && pieces.filter((p) => p.exotic).length !== 1)
    return "missing exotic";
  for (const r of input.setRequirements ?? [])
    if (pieces.filter((p) => p.setHash === r.setHash).length < r.count) return "set req";
  if (input.powerRange) {
    const pw = oraclePower(pieces, input.powerRange);
    if (pw !== null && (pw < input.powerRange.min || pw > input.powerRange.max)) return "power range";
  }
  let total = 0;
  for (let s = 0; s < NS; s++) {
    let base = frag[s];
    for (const p of pieces) base += p.stats[s];
    const v = clamp(base + lo.tuningBonus[s] + lo.modBonus[s] + lo.artificeBonus[s]);
    if (lo.stats[s] !== v) return `stat ${s} reconstruction`;
    if (lo.stats[s] < Math.min(input.minimums[s], 200)) return `stat ${s} below min`;
    total += v;
  }
  if (total !== lo.total) return "total";
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  if (lo.modsUsed.major > major || lo.modsUsed.minor > minor) return "mod budget";
  return null;
}

// ---------------------------------------------------------------------------
// Query generator (tiny pools)
// ---------------------------------------------------------------------------

export const SET_A = 7;
export const SET_B = 8;
export const EXO_HASHES = [1000, 1001, 1002];

let pieceSerial = 0;
export function randomPiece(
  r: Rnd,
  opts: { exotic: boolean; tunable: boolean; artifice: boolean; withPower: boolean },
): OptimizerPiece {
  const idx = [0, 1, 2, 3, 4, 5];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const stats = [5, 5, 5, 5, 5, 5];
  stats[idx[0]] = 30;
  stats[idx[1]] = 25;
  stats[idx[2]] = 20;
  if (chance(r, 0.2)) for (let s = 0; s < NS; s++) stats[s] = ri(r, 0, 22);
  // Near-zero stats (with negative fragments these push a stat below 0 pre-clamp).
  if (chance(r, 0.1)) stats[idx[5]] = 0;
  const off = idx.slice(3).sort((a, b) => a - b);
  const p: OptimizerPiece = {
    id: `p${pieceSerial++}`,
    stats,
    exotic: opts.exotic,
  };
  if (opts.exotic) p.hash = pick(r, EXO_HASHES);
  const sr = r();
  if (sr < 0.35) p.setHash = SET_A;
  else if (sr < 0.5) p.setHash = SET_B;
  if (opts.artifice) p.artifice = true;
  else if (chance(r, 0.1)) p.artifice = false;
  if (opts.tunable) {
    p.tuning = { tuned: off[ri(r, 0, 2)], offStats: off };
    if (chance(r, 0.15)) p.tuning.directional = false;
  }
  if (opts.withPower) {
    const pr = r();
    if (pr < 0.15) p.power = undefined;
    else if (pr < 0.25) p.power = 0;
    else p.power = ri(r, 1995, 2010);
  }
  return p;
}

export function randomQuery(r: Rnd, maxPerSlot = 3, minPerSlot = 1, maxTunable = 3): OptimizerInput {
  const exoticSlot = chance(r, 0.55) ? ri(r, 0, NSLOT - 1) : -1;
  const withPower = chance(r, 0.4);
  let tunableLegendaries = 0;
  const slots: OptimizerPiece[][] = Array.from({ length: NSLOT }, (_, k) =>
    Array.from({ length: ri(r, minPerSlot, maxPerSlot) }, (_, i) => {
      const exotic = k === exoticSlot && (i === 0 || chance(r, 0.3));
      let tunable = chance(r, 0.5);
      if (!exotic && tunable) {
        if (tunableLegendaries >= maxTunable) tunable = false;
        else tunableLegendaries++;
      }
      const artifice = !tunable && chance(r, 0.3);
      return randomPiece(r, { exotic, tunable, artifice, withPower });
    }),
  );
  const input: OptimizerInput = { slots, minimums: [0, 0, 0, 0, 0, 0] };
  if (chance(r, 0.85)) input.mods = { major: ri(r, 0, 2), minor: ri(r, 0, 2) };
  if (chance(r, 0.6))
    input.fragmentBonus = Array.from({ length: NS }, () => (chance(r, 0.3) ? ri(r, -2, 2) * 10 : 0));
  // Occasionally a deeply negative fragment total so a stat sits below 0 before the clamp.
  if (input.fragmentBonus && chance(r, 0.15)) input.fragmentBonus[ri(r, 0, NS - 1)] = -pick(r, [30, 40, 50, 60]);
  const tr = r();
  if (tr < 0.1) input.allowTuning = false;
  else if (tr < 0.5) input.allowTuning = true;
  const br = r();
  if (br < 0.2) input.allowBalancedTuning = false;
  else if (br < 0.5) input.allowBalancedTuning = true;
  // Exotic constraint.
  const er = r();
  if (er < 0.3) {
    // leave undefined
  } else {
    const mode = pick(r, ["any", "none", "require", "specific"] as const);
    input.exotic = { mode };
    if (mode === "specific" || chance(r, 0.3)) {
      const exHashes = slots.flat().filter((p) => p.exotic).map((p) => p.hash!);
      const hs = new Set<number>();
      if (exHashes.length && chance(r, 0.8)) hs.add(pick(r, exHashes));
      if (chance(r, 0.3)) hs.add(pick(r, EXO_HASHES));
      input.exotic.hashes = [...hs];
    }
  }
  // Set requirements.
  const sr = r();
  if (sr < 0.5) {
    // none
  } else if (sr < 0.6) input.setRequirements = [];
  else {
    const n = chance(r, 0.75) ? 1 : 2;
    input.setRequirements = Array.from({ length: n }, () => ({
      setHash: chance(r, 0.9) ? pick(r, [SET_A, SET_B]) : 99,
      count: chance(r, 0.85) ? ri(r, 1, 2) : 3,
    }));
  }
  if (withPower && chance(r, 0.75)) {
    const lo = ri(r, 1990, 2004);
    input.powerRange = { min: lo, max: lo + ri(r, 0, 12) };
    const wr = r();
    if (wr < 0.3) input.powerRange.weapons = [];
    else if (wr < 0.6) input.powerRange.weapons = Array.from({ length: ri(r, 1, 3) }, () => ri(r, 1995, 2012));
  }
  const mr = r();
  if (mr < 0.15) input.maxResults = ri(r, 1, 3);
  else if (mr < 0.25) input.maxResults = 200;
  // Minimums near a real completion.
  const ref = slots.map((sp) => pick(r, sp));
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  for (let s = 0; s < NS; s++) {
    if (chance(r, 0.5)) continue;
    let v = frag[s];
    for (const p of ref) v += p.stats[s];
    v += ri(r, -14, 8);
    input.minimums[s] = Math.max(0, Math.min(200, v));
  }
  return input;
}

// ---------------------------------------------------------------------------
// Edit generator
// ---------------------------------------------------------------------------

export interface Edit {
  kind: string;
  /** True when the edit cannot change the solver's semantics (pure re-representation). */
  noop: boolean;
  /** True when ONLY minimums changed (comparator must say same-query). */
  minsOnly: boolean;
  next: OptimizerInput;
}

const cloneInput = (x: OptimizerInput): OptimizerInput => ({
  ...x,
  slots: x.slots.map((s) => s.slice()),
  minimums: x.minimums.slice(),
});

function minEdit(r: Rnd, prev: OptimizerInput): Edit {
  const next = cloneInput(prev);
  const m = next.minimums;
  const kind = pick(r, [
    "tighten1",
    "loosen1",
    "tightenBig",
    "loosenBig",
    "to0",
    "to200",
    "from0",
    "from200",
    "mixed",
    "equal",
    "multiTighten",
    "multiLoosen",
  ] as const);
  const s = ri(r, 0, NS - 1);
  switch (kind) {
    case "tighten1":
      m[s] = Math.min(200, m[s] + 1);
      break;
    case "loosen1":
      m[s] = Math.max(0, m[s] - 1);
      break;
    case "tightenBig":
      m[s] = Math.min(200, m[s] + ri(r, 2, 40));
      break;
    case "loosenBig":
      m[s] = Math.max(0, m[s] - ri(r, 2, 40));
      break;
    case "to0":
      m[s] = 0;
      break;
    case "to200":
      m[s] = 200;
      break;
    case "from0": {
      const z = m.findIndex((v) => v === 0);
      if (z >= 0) m[z] = ri(r, 1, 120);
      break;
    }
    case "from200": {
      const z = m.findIndex((v) => v === 200);
      if (z >= 0) m[z] = ri(r, 0, 199);
      else m[s] = Math.max(0, m[s] - 5);
      break;
    }
    case "mixed": {
      const t = (s + ri(r, 1, 5)) % NS;
      m[s] = Math.min(200, m[s] + ri(r, 1, 20));
      m[t] = Math.max(0, m[t] - ri(r, 1, 20));
      break;
    }
    case "equal":
      break;
    case "multiTighten":
      for (let i = 0; i < NS; i++) if (chance(r, 0.5)) m[i] = Math.min(200, m[i] + ri(r, 0, 15));
      break;
    case "multiLoosen":
      for (let i = 0; i < NS; i++) if (chance(r, 0.5)) m[i] = Math.max(0, m[i] - ri(r, 0, 15));
      break;
  }
  return { kind: `min:${kind}`, noop: false, minsOnly: true, next };
}

const editPiece = (
  prev: OptimizerInput,
  r: Rnd,
  f: (p: OptimizerPiece) => OptimizerPiece,
): OptimizerInput => {
  const next = cloneInput(prev);
  const k = ri(r, 0, NSLOT - 1);
  const i = ri(r, 0, next.slots[k].length - 1);
  next.slots[k][i] = f(next.slots[k][i]);
  return next;
};

/** Field edits; each reports whether it is a semantic no-op for the solver. */
function fieldEdit(r: Rnd, prev: OptimizerInput): Edit {
  const kinds = [
    "modsDefault",
    "modsChange",
    "modsMinorOnly",
    "modsMajorOnly",
    "exoticHashesInPool",
    "powerExtreme",
    "weaponsExtreme",
    "fragDefault",
    "fragSameSum",
    "fragChange",
    "exoticDefault",
    "exoticMode",
    "exoticHashes",
    "strayHashes",
    "setReorder",
    "setDup",
    "setCount",
    "setEmptyVsUndef",
    "tuningDefault",
    "tuningToggle",
    "balancedToggle",
    "balancedWhileOff",
    "powerToggle",
    "powerWeaponsEmpty",
    "powerWeaponsReorder",
    "powerBounds",
    "maxResultsDefault",
    "maxResultsChange",
    "statsNewRef",
    "statsChange",
    "artificeUndefFalse",
    "artificeToggle",
    "powerUndef0",
    "powerValue",
    "directionalUndefFalse",
    "pieceReorder",
    "pieceClone",
    "pieceRemove",
    "pieceAdd",
    "hashOnLegendary",
  ] as const;
  const kind = pick(r, kinds);
  let next = cloneInput(prev);
  let noop = false;
  switch (kind) {
    case "modsDefault":
      noop = true;
      if (next.mods === undefined) next.mods = { major: 0, minor: 0 };
      else if (next.mods.major === 0 && next.mods.minor === 0) next.mods = undefined;
      else next.mods = { ...next.mods };
      break;
    case "modsMinorOnly": {
      const m = next.mods ?? { major: 0, minor: 0 };
      next.mods = { major: m.major, minor: m.minor > 0 && chance(r, 0.5) ? m.minor - 1 : m.minor + 1 };
      break;
    }
    case "modsMajorOnly": {
      const m = next.mods ?? { major: 0, minor: 0 };
      next.mods = { major: m.major > 0 && chance(r, 0.5) ? m.major - 1 : m.major + 1, minor: m.minor };
      break;
    }
    case "exoticHashesInPool": {
      // Point a specific-exotic constraint at a different exotic that is really in the pool.
      const inPool = [...new Set(next.slots.flat().filter((p) => p.exotic).map((p) => p.hash!))];
      const cur = next.exotic?.hashes ?? [];
      const other = inPool.filter((h) => !cur.includes(h));
      const hashes = other.length && chance(r, 0.7) ? [pick(r, other)] : cur.length > 1 ? cur.slice(1) : inPool;
      next.exotic = { mode: "specific", hashes };
      break;
    }
    case "powerExtreme": {
      if (!next.powerRange) next.powerRange = { min: 1995, max: 2005 };
      next = editPiece(next, r, (p) => ({ ...p, power: pick(r, [1900, 2100, 0]) }));
      break;
    }
    case "weaponsExtreme": {
      const base = next.powerRange ?? { min: 1995, max: 2005 };
      next.powerRange = { ...base, weapons: [pick(r, [1950, 2050, 2002])] };
      break;
    }
    case "modsChange":
      next.mods = { major: ri(r, 0, 2), minor: ri(r, 0, 2) };
      break;
    case "fragDefault":
      noop = true;
      if (next.fragmentBonus === undefined) next.fragmentBonus = [0, 0, 0, 0, 0, 0];
      else if (next.fragmentBonus.every((v) => v === 0)) next.fragmentBonus = undefined;
      else next.fragmentBonus = next.fragmentBonus.slice();
      break;
    case "fragSameSum": {
      const f = (next.fragmentBonus ?? [0, 0, 0, 0, 0, 0]).slice();
      const a = ri(r, 0, NS - 1);
      const b = (a + ri(r, 1, 5)) % NS;
      f[a] += 10;
      f[b] -= 10;
      next.fragmentBonus = f;
      break;
    }
    case "fragChange": {
      const f = (next.fragmentBonus ?? [0, 0, 0, 0, 0, 0]).slice();
      f[ri(r, 0, NS - 1)] += pick(r, [-10, 10, 20]);
      next.fragmentBonus = f;
      break;
    }
    case "exoticDefault":
      if (next.exotic === undefined) {
        next.exotic = { mode: "any" };
        noop = true;
      } else if (next.exotic.mode === "any") {
        next.exotic = undefined;
        noop = true;
      } else next.exotic = { ...next.exotic };
      noop = true;
      break;
    case "exoticMode":
      next.exotic = { ...(next.exotic ?? { mode: "any" }), mode: pick(r, ["any", "none", "require", "specific"] as const) };
      break;
    case "exoticHashes": {
      const hs = new Set(next.exotic?.hashes ?? []);
      const h = pick(r, EXO_HASHES);
      if (hs.has(h)) hs.delete(h);
      else hs.add(h);
      next.exotic = { mode: next.exotic?.mode ?? "specific", hashes: [...hs] };
      break;
    }
    case "strayHashes": {
      const mode = next.exotic?.mode ?? "any";
      if (mode === "specific") {
        // reorder hashes: semantically identical
        next.exotic = { mode, hashes: [...(next.exotic?.hashes ?? [])].reverse() };
      } else {
        next.exotic = { mode, hashes: chance(r, 0.5) ? [pick(r, EXO_HASHES)] : undefined };
      }
      noop = true;
      break;
    }
    case "setReorder":
      noop = true;
      next.setRequirements = next.setRequirements ? [...next.setRequirements].reverse() : undefined;
      break;
    case "setDup": {
      const reqs = next.setRequirements ?? [];
      if (reqs.length) {
        next.setRequirements = [...reqs, { ...reqs[0] }];
        noop = true; // duplicating a requirement doesn't change the constraint
      } else next.setRequirements = [{ setHash: SET_A, count: 1 }];
      break;
    }
    case "setCount": {
      const reqs = (next.setRequirements ?? []).map((x) => ({ ...x }));
      if (reqs.length) reqs[0].count = Math.max(0, reqs[0].count + pick(r, [-1, 1]));
      else reqs.push({ setHash: pick(r, [SET_A, SET_B]), count: ri(r, 1, 2) });
      next.setRequirements = reqs;
      break;
    }
    case "setEmptyVsUndef":
      if (!next.setRequirements || next.setRequirements.length === 0) {
        noop = true;
        next.setRequirements = next.setRequirements ? undefined : [];
      } else next.setRequirements = undefined;
      break;
    case "tuningDefault":
      if (next.allowTuning === undefined) {
        next.allowTuning = true;
        noop = true;
      } else if (next.allowTuning === true) {
        next.allowTuning = undefined;
        noop = true;
      } else next.allowTuning = true;
      break;
    case "tuningToggle":
      next.allowTuning = !(next.allowTuning ?? true);
      break;
    case "balancedToggle":
      next.allowBalancedTuning = !(next.allowBalancedTuning ?? true);
      noop = (next.allowTuning ?? true) === false;
      break;
    case "balancedWhileOff":
      next.allowTuning = false;
      next.allowBalancedTuning = !(next.allowBalancedTuning ?? true);
      noop = (prev.allowTuning ?? true) === false;
      break;
    case "powerToggle":
      if (next.powerRange) next.powerRange = undefined;
      else next.powerRange = { min: ri(r, 1990, 2004), max: ri(r, 2004, 2012) };
      break;
    case "powerWeaponsEmpty":
      if (next.powerRange) {
        const w = next.powerRange.weapons;
        if (w === undefined) next.powerRange = { ...next.powerRange, weapons: [] };
        else if (w.length === 0) next.powerRange = { min: next.powerRange.min, max: next.powerRange.max };
        else next.powerRange = { ...next.powerRange, weapons: w.slice() };
        noop = true;
      } else {
        next.powerRange = undefined;
        noop = true;
      }
      break;
    case "powerWeaponsReorder":
      if (next.powerRange?.weapons && next.powerRange.weapons.length > 1) {
        next.powerRange = { ...next.powerRange, weapons: [...next.powerRange.weapons].reverse() };
        noop = true;
      } else if (next.powerRange) {
        next.powerRange = { ...next.powerRange, weapons: [ri(r, 1995, 2012), ri(r, 1995, 2012)] };
      }
      break;
    case "powerBounds":
      if (next.powerRange)
        next.powerRange = { ...next.powerRange, min: next.powerRange.min + pick(r, [-1, 1]) };
      else next.powerRange = { min: 0, max: 99999 };
      break;
    case "maxResultsDefault":
      if (next.maxResults === undefined) next.maxResults = 200;
      else if (next.maxResults === 200) next.maxResults = undefined;
      else next.maxResults = 200;
      noop = prev.maxResults === undefined || prev.maxResults === 200;
      break;
    case "maxResultsChange":
      next.maxResults = ri(r, 1, 4);
      break;
    case "statsNewRef":
      noop = true;
      next = editPiece(prev, r, (p) => ({ ...p, stats: p.stats.slice() }));
      break;
    case "statsChange":
      next = editPiece(prev, r, (p) => {
        const st = p.stats.slice();
        st[ri(r, 0, NS - 1)] += pick(r, [-5, 5, 1]);
        return { ...p, stats: st };
      });
      break;
    case "artificeUndefFalse":
      noop = true;
      next = editPiece(prev, r, (p) => {
        if (p.artifice) return { ...p };
        const q = { ...p };
        if (q.artifice === undefined) q.artifice = false;
        else delete q.artifice;
        return q;
      });
      break;
    case "artificeToggle":
      next = editPiece(prev, r, (p) => ({ ...p, artifice: !p.artifice }));
      break;
    case "powerUndef0":
      next = editPiece(prev, r, (p) => {
        const q = { ...p };
        if (q.power === undefined) q.power = 0;
        else if (q.power === 0) delete q.power;
        else q.power = undefined;
        return q;
      });
      noop = !prev.powerRange;
      break;
    case "powerValue":
      next = editPiece(prev, r, (p) => ({ ...p, power: ri(r, 1995, 2010) }));
      noop = !prev.powerRange;
      break;
    case "directionalUndefFalse":
      next = editPiece(prev, r, (p) => {
        if (!p.tuning) return { ...p };
        const t = { ...p.tuning };
        if (t.directional === false) delete t.directional;
        else t.directional = false;
        return { ...p, tuning: t };
      });
      break;
    case "pieceReorder": {
      const k = ri(r, 0, NSLOT - 1);
      next.slots[k] = [...next.slots[k]].reverse();
      noop = next.slots[k].length <= 1;
      break;
    }
    case "pieceClone":
      noop = true;
      next = cloneInput(prev);
      next.slots = next.slots.map((s) =>
        s.map((p) => ({ ...p, stats: p.stats.slice(), tuning: p.tuning ? { ...p.tuning, offStats: p.tuning.offStats.slice() } : undefined })),
      );
      // keep absent-vs-undefined tuning key: drop explicit undefined
      for (const s of next.slots) for (const p of s) if (p.tuning === undefined) delete p.tuning;
      break;
    case "pieceRemove": {
      const k = ri(r, 0, NSLOT - 1);
      if (next.slots[k].length > 1) next.slots[k] = next.slots[k].slice(1);
      break;
    }
    case "pieceAdd": {
      const k = ri(r, 0, NSLOT - 1);
      next.slots[k] = [
        ...next.slots[k],
        randomPiece(r, { exotic: chance(r, 0.2), tunable: chance(r, 0.4), artifice: chance(r, 0.2), withPower: !!prev.powerRange || chance(r, 0.3) }),
      ];
      break;
    }
    case "hashOnLegendary":
      next = editPiece(prev, r, (p) => (p.exotic ? { ...p } : { ...p, hash: p.hash === undefined ? 4242 : undefined }));
      break;
  }
  return { kind: `field:${kind}`, noop, minsOnly: false, next };
}

export function randomEdit(r: Rnd, prev: OptimizerInput): Edit {
  const x = r();
  if (x < 0.55) return minEdit(r, prev);
  const fe = fieldEdit(r, prev);
  if (x < 0.65) {
    // field edit + a min edit together
    const me = minEdit(r, fe.next);
    return { kind: `${fe.kind}+${me.kind}`, noop: false, minsOnly: false, next: me.next };
  }
  return fe;
}

// ---------------------------------------------------------------------------
// Stubbed clock
// ---------------------------------------------------------------------------

/**
 * Run `fn` with performance.now replaced by a clock that advances `step()` ms per call.
 * Every timing decision in the solver flows through performance.now, so this makes
 * capping/time-outs land at deterministic, seed-controlled points.
 */
export function withClock<T>(step: () => number, fn: () => T): T {
  let t = 1000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => (t += step()));
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

export const describeInput = (x: OptimizerInput) => JSON.stringify(x);

/**
 * Large "blind-spot" pools: clamp-heavy fillers (most points piled into one stat, so the
 * 200 clamp wastes them and the admission bound stays loose) keep the walk long enough to
 * pass the solver's 65,536-node clock checks — the only place a top-N walk can cap.
 */
export function blindSpotQuery(r: Rnd): OptimizerInput {
  const heavy = ri(r, 0, NS - 1);
  const filler = (slot: number, n: number): OptimizerPiece[] =>
    Array.from({ length: n }, (_, j) => {
      const st = [0, 0, 0, 0, 0, 0];
      const other = (heavy + 1 + ri(r, 0, 4)) % NS;
      st[heavy] = 90 - j - ri(r, 0, 3);
      st[other] += 90 - st[heavy];
      const p: OptimizerPiece = { id: `f${slot}_${j}_${pieceSerial++}`, stats: st, exotic: false };
      if (chance(r, 0.15)) p.setHash = pick(r, [SET_A, SET_B]);
      if (chance(r, 0.1)) p.artifice = true;
      if (chance(r, 0.15)) {
        const off = [0, 1, 2, 3, 4, 5].filter((s) => s !== heavy && s !== other).slice(0, 3);
        p.tuning = { tuned: off[0], offStats: off };
      }
      if (chance(r, 0.3)) p.power = ri(r, 1998, 2004);
      return p;
    });
  const spread = (): OptimizerPiece => ({
    id: `s${pieceSerial++}`,
    stats: [15, 15, 15, 15, 15, 15].map((v) => v + ri(r, -3, 3)),
    exotic: chance(r, 0.3),
    hash: 1000,
  });
  const slots: OptimizerPiece[][] = [
    [...filler(0, ri(r, 1, 3)), spread(), ...(chance(r, 0.5) ? [spread()] : [])],
    filler(1, ri(r, 12, 17)),
    filler(2, ri(r, 12, 17)),
    filler(3, ri(r, 12, 17)),
    filler(4, ri(r, 12, 17)),
  ];
  const input: OptimizerInput = { slots, minimums: [0, 0, 0, 0, 0, 0], allowTuning: chance(r, 0.4) };
  if (chance(r, 0.5)) input.mods = { major: ri(r, 0, 1), minor: ri(r, 0, 1) };
  if (chance(r, 0.3)) input.minimums[heavy] = ri(r, 100, 200);
  if (chance(r, 0.2)) input.maxResults = pick(r, [1, 5, 50]);
  if (chance(r, 0.2)) input.setRequirements = [{ setHash: SET_A, count: 1 }];
  if (chance(r, 0.15)) input.powerRange = { min: 1990, max: 2010 };
  if (chance(r, 0.2)) input.exotic = { mode: pick(r, ["any", "none", "require"] as const) };
  return input;
}
