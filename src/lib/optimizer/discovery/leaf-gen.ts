/**
 * Single-loadout generator + independent brute force for the leaf-tuner discovery tests
 * (metamorphic-tuner.test.ts). The brute force is written from the game rules only — every
 * tuning option per piece × every (major, minor, artifice) covering — and shares nothing
 * with the production search beyond the piece type.
 */
import fc from "fast-check";
import { expect } from "vitest";
import { NUM_SLOTS, NUM_STATS, clamp } from "../floors";
import {
  assignMods,
  createTuningSearcher,
  makeInternalPiece,
  type InternalPiece,
  type TuningOutcome,
} from "../tuning";
import type { ModBudget, OptimizerPiece } from "../types";
import { permuteStats, pieceSpecArb, specToPiece } from "./metamorphic-gen";

// ---------------------------------------------------------------------------
// Single-loadout generator
// ---------------------------------------------------------------------------

export interface LeafCase {
  pieces: OptimizerPiece[];
  allowTuning: boolean;
  allowBalanced: boolean;
  frag: number[];
  mods: ModBudget;
  mins: number[];
}

export const leafArb: fc.Arbitrary<LeafCase> = fc
  .noBias(
    fc.record({
      specs: fc.array(pieceSpecArb({ exoticRate: 0, artificeRate: 0.35 }), {
        minLength: NUM_SLOTS,
        maxLength: NUM_SLOTS,
      }),
      exoticSlot: fc.integer({ min: -1, max: NUM_SLOTS - 1 }),
      intrinsic: fc.array(fc.constantFrom(0, 0, 0, 2, 5, 10), { minLength: 6, maxLength: 6 }),
      allowTuning: fc.integer({ min: 0, max: 9 }).map((x) => x > 0),
      allowBalanced: fc.integer({ min: 0, max: 4 }).map((x) => x > 0),
      balancedOnly: fc.array(fc.integer({ min: 0, max: 6 }).map((x) => x === 0), {
        minLength: NUM_SLOTS,
        maxLength: NUM_SLOTS,
      }),
      frag: fc.array(fc.constantFrom(0, 0, 0, 0, 10, 20, -10, -20, -30), {
        minLength: NUM_STATS,
        maxLength: NUM_STATS,
      }),
      major: fc.integer({ min: 0, max: 5 }),
      minor: fc.integer({ min: 0, max: 5 }),
      minKind: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: NUM_STATS, maxLength: NUM_STATS }),
      minOff: fc.array(fc.integer({ min: -8, max: 14 }), { minLength: NUM_STATS, maxLength: NUM_STATS }),
    }),
  )
  .map((r) => {
    const pieces = r.specs.map((s, k) => {
      const p = specToPiece({ ...s, exotic: k === r.exoticSlot, intrinsic: r.intrinsic }, `p${k}`);
      // Dream-style "any tuned stat" legendary: Balanced only, no directional.
      if (p.tuning && !p.exotic && r.balancedOnly[k]) p.tuning = { ...p.tuning, directional: false };
      return p;
    });
    const sum = new Array(NUM_STATS).fill(0);
    for (const p of pieces) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
    // Minimums near the loadout's own values so the slow path (directionals) runs often.
    const mins = sum.map((v, s) => {
      const kind = r.minKind[s];
      if (kind < 4) return 0;
      if (kind === 9) return 200;
      return Math.max(1, Math.min(200, v + r.frag[s] + r.minOff[s]));
    });
    return {
      pieces,
      allowTuning: r.allowTuning,
      allowBalanced: r.allowBalanced,
      frag: r.frag,
      mods: { major: r.major, minor: Math.min(r.minor, 5 - r.major) },
      mins,
    };
  });

export function internal(c: LeafCase, order?: number[]): { chosen: InternalPiece[]; sum: number[] } {
  const pieces = order ? order.map((i) => c.pieces[i]) : c.pieces;
  const chosen = pieces.map((p) => makeInternalPiece(p, c.allowTuning, c.allowBalanced, c.mins));
  const sum = new Array(NUM_STATS).fill(0);
  for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
  return { chosen, sum };
}

export function tune(c: LeafCase, mode: "maximize" | "feasible", over: Partial<LeafCase> = {}, order?: number[]): TuningOutcome | null {
  const cc = { ...c, ...over };
  const { chosen, sum } = internal(cc, order);
  return createTuningSearcher(cc.frag, cc.mods)(chosen, sum, cc.mins, mode);
}

// ---------------------------------------------------------------------------
// Independent brute force (game rules only)
// ---------------------------------------------------------------------------

export function ruleTuneVecs(p: OptimizerPiece, c: LeafCase): number[][] {
  const zero = [0, 0, 0, 0, 0, 0];
  if (!c.allowTuning || !p.tuning) return [zero];
  const out: number[][] = [zero];
  if (c.allowBalanced) {
    const b = zero.slice();
    for (const s of p.tuning.offStats) b[s] += 1;
    out.push(b);
  }
  if (p.tuning.directional === false) return out;
  const plus = p.exotic ? [0, 1, 2, 3, 4, 5] : [p.tuning.tuned];
  for (const t of plus) {
    for (let m = 0; m < NUM_STATS; m++) {
      if (m === t) continue;
      const v = zero.slice();
      v[t] += 5;
      v[m] -= 5;
      out.push(v);
    }
  }
  return out;
}

/** Every covering of `deficits` with (major, minor, artifice) — exhaustive. */
export function bruteCoverExists(deficits: number[], major: number, minor: number, art: number): boolean {
  const rec = (s: number, M: number, m: number, A: number): boolean => {
    if (s === NUM_STATS) return true;
    const d = deficits[s];
    if (d <= 0) return rec(s + 1, M, m, A);
    for (let a = 0; a <= M; a++)
      for (let b = 0; b <= m; b++)
        for (let x = 0; x <= A; x++)
          if (a * 10 + b * 5 + x * 3 >= d && rec(s + 1, M - a, m - b, A - x)) return true;
    return false;
  };
  return rec(0, major, minor, art);
}

/** Does ANY tuning-option combination + covering meet the minimums? */
export function bruteFeasible(c: LeafCase): boolean {
  const vecs = c.pieces.map((p) => ruleTuneVecs(p, c));
  const art = c.pieces.filter((p) => p.artifice).length;
  const pre = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    pre[s] = c.frag[s];
    for (const p of c.pieces) pre[s] += p.stats[s];
  }
  const seen = new Set<string>();
  const rec = (i: number): boolean => {
    if (i === NUM_SLOTS) {
      const d = pre.map((v, s) => (c.mins[s] > 0 && v < c.mins[s] ? c.mins[s] - v : 0));
      const key = d.join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return bruteCoverExists(d, c.mods.major, c.mods.minor, art);
    }
    for (const v of vecs[i]) {
      for (let s = 0; s < NUM_STATS; s++) pre[s] += v[s];
      const ok = rec(i + 1);
      for (let s = 0; s < NUM_STATS; s++) pre[s] -= v[s];
      if (ok) return true;
    }
    return false;
  };
  return rec(0);
}

export function expectOutcomeLegal(c: LeafCase, o: TuningOutcome, ctx: string): void {
  let total = 0;
  const art = c.pieces.filter((p) => p.artifice).length;
  for (let s = 0; s < NUM_STATS; s++) {
    let base = c.frag[s];
    for (const p of c.pieces) base += p.stats[s];
    const v = clamp(base + o.tuningBonus[s] + o.modBonus[s] + o.artificeBonus[s]);
    expect(o.stats[s], `${ctx}: stat ${s}`).toBe(v);
    if (c.mins[s] > 0) expect(o.stats[s], `${ctx}: min ${s}`).toBeGreaterThanOrEqual(Math.min(200, c.mins[s]));
    total += v;
  }
  expect(o.total, ctx).toBe(total);
  expect(o.modsUsed.major, ctx).toBeLessThanOrEqual(c.mods.major);
  expect(o.modsUsed.minor, ctx).toBeLessThanOrEqual(c.mods.minor);
  expect(o.artificeBonus.reduce((x, y) => x + y, 0), ctx).toBeLessThanOrEqual(3 * art);
}


export const showLeaf = (c: LeafCase): string =>
  JSON.stringify({ ...c, pieces: c.pieces.map((p) => ({ s: p.stats, x: p.exotic, t: p.tuning, a: p.artifice })) });

export function relabelLeaf(c: LeafCase, perm: number[]): LeafCase {
  return {
    ...c,
    pieces: c.pieces.map((p) => ({
      ...p,
      stats: permuteStats(p.stats, perm),
      tuning: p.tuning && {
        ...p.tuning,
        tuned: perm[p.tuning.tuned],
        offStats: p.tuning.offStats.map((s) => perm[s]).sort((a, b) => a - b),
      },
    })),
    mins: permuteStats(c.mins, perm),
    frag: permuteStats(c.frag, perm),
  };
}

/**
 * Loadouts pushed toward the 200 cap: every piece gets the same per-stat boost (0–30),
 * so five-piece sums land near/over 200 and the cap arm of the tuner's pruning (the
 * plain-minus cap condition, the artifice dump's clamped gains) is exercised.
 */
export const highLeafArb: fc.Arbitrary<LeafCase> = fc
  .tuple(leafArb, fc.noBias(fc.array(fc.constantFrom(0, 10, 20, 30), { minLength: 6, maxLength: 6 })))
  .map(([c, boost]) => ({
    ...c,
    pieces: c.pieces.map((p) => ({ ...p, stats: p.stats.map((v, s) => v + boost[s]) })),
    mins: c.mins.map((m, s) => (m > 0 && m < 200 ? Math.min(200, m + 5 * boost[s]) : m)),
  }));

/**
 * The tuner's search tree with NO pruning (no plain-minus dominance, no branch-and-bound,
 * no joint prune): default-everywhere first; if that is infeasible, every combination
 * where each directional passes the same per-node "could still be short" rule. Leaf total
 * = assignMods covering + leftover artifice placed by exhaustive search. Returns the max
 * total (the tuner keeps the first maximum, so totals must match exactly).
 */
export function referenceMaximize(c: LeafCase, order?: number[]): number | null {
  const { chosen, sum } = internal(c, order);
  const art = chosen.filter((p) => p.artifice).length;
  const aug = sum.map((v, s) => v + c.frag[s]);
  const leaf = (): number | null => {
    const d = aug.map((v, s) => (c.mins[s] > 0 && v < c.mins[s] ? c.mins[s] - v : 0));
    const asg = assignMods(d, c.mods.major, c.mods.minor, art);
    if (!asg) return null;
    const base = aug.map((v, s) => v + asg.points[s] + asg.artificePoints[s]);
    let best = -Infinity;
    const rec = (s: number, left: number, acc: number): void => {
      if (s === NUM_STATS) {
        if (acc > best) best = acc;
        return;
      }
      for (let k = 0; k <= left; k++) rec(s + 1, left - k, acc + clamp(base[s] + 3 * k));
    };
    rec(0, art - asg.usedArtifice, 0);
    return best;
  };
  for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) aug[s] += p.tuneOpts[0].vec[s];
  const fast = leaf();
  if (fast !== null) return fast;
  for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) aug[s] -= p.tuneOpts[0].vec[s];
  const down: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () => new Array(NUM_STATS).fill(0));
  for (let i = NUM_SLOTS - 1; i >= 0; i--)
    for (let s = 0; s < NUM_STATS; s++) down[i][s] = down[i + 1][s] + chosen[i].tuneStatDownside[s];
  let best: number | null = null;
  const rec = (i: number): void => {
    if (i === NUM_SLOTS) {
      const t = leaf();
      if (t !== null && (best === null || t > best)) best = t;
      return;
    }
    const def = chosen[i].tuneOpts[0].vec;
    for (const opt of chosen[i].tuneOpts) {
      const ap = opt.applied;
      if (ap && ap.kind === "directional") {
        const m = c.mins[ap.plus];
        if (m <= 0 || aug[ap.plus] + def[ap.plus] + down[i + 1][ap.plus] >= m) continue;
      }
      for (let s = 0; s < NUM_STATS; s++) aug[s] += opt.vec[s];
      rec(i + 1);
      for (let s = 0; s < NUM_STATS; s++) aug[s] -= opt.vec[s];
    }
  };
  rec(0);
  return best;
}
