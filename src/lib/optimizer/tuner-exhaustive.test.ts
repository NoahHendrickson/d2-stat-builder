/**
 * The leaf tuner's pruning must be invisible: for a given loadout it has to return the
 * SAME leaf an unpruned enumeration of its own search tree would — the first maximum in
 * option order (maximize) or the first feasible leaf (feasible mode). This pins the
 * plain-minus dominance rule and the branch-and-bound cutoff, both of which only skip
 * work, never change an answer: a returned build differing in any field (tuning
 * placement, mod bonus, stats) from the unpruned walk is a bug here.
 *
 * The reference walks the same tree shape the searcher does (default option first,
 * directionals only where the +5 stat could still be short) with NO pruning inside it —
 * so what is tested is exactly the pruning. Loadouts are artifice-free so a leaf's total
 * is the plain Σ clamp(aug + mod points); the artifice dump is covered by the oracle test.
 */
import { describe, expect, test } from "vitest";
import {
  NUM_SLOTS,
  NUM_STATS,
  assignMods,
  clamp,
  createTuningSearcher,
  makeInternalPiece,
  minShortfall,
  type InternalPiece,
  type TuningOutcome,
} from "./tuning";
import type { AppliedTuning, ModBudget, OptimizerPiece } from "./types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

interface Case {
  chosen: InternalPiece[];
  sum: number[];
  frag: number[];
  mods: ModBudget;
  mins: number[];
}

/** One loadout: up to one exotic (most cases have one), tunable legendaries, a few untunable. */
function randomCase(rng: () => number): Case {
  const exoticSlot = rng() < 0.8 ? randInt(rng, 0, NUM_SLOTS - 1) : -1;
  const allowBalanced = rng() < 0.8;
  const chosen: InternalPiece[] = [];
  for (let k = 0; k < NUM_SLOTS; k++) {
    const idx = [0, 1, 2, 3, 4, 5];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const stats = [5, 5, 5, 5, 5, 5];
    stats[idx[0]] = 30;
    stats[idx[1]] = 25;
    stats[idx[2]] = 20;
    if (rng() < 0.2) for (let s = 0; s < NUM_STATS; s++) stats[s] = randInt(rng, 0, 40);
    const off = idx.slice(3).sort((a, b) => a - b);
    const p: OptimizerPiece = {
      id: `p${k}`,
      stats,
      exotic: k === exoticSlot,
      tuning: rng() < 0.85 ? { tuned: off[randInt(rng, 0, 2)], offStats: off } : undefined,
    };
    chosen.push(makeInternalPiece(p, true, allowBalanced));
  }
  const frag = Array.from({ length: NUM_STATS }, () =>
    rng() < 0.3 ? randInt(rng, -2, 2) * 10 : 0,
  );
  const sum = new Array(NUM_STATS).fill(0);
  for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
  const mods: ModBudget = { major: randInt(rng, 0, 3), minor: randInt(rng, 0, 3) };
  // Minimums near the loadout's own values so the slow path (directionals) runs often,
  // with the occasional far-off one for infeasible leaves and the occasional 200.
  const mins = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    const r = rng();
    if (r < 0.45) continue;
    if (r < 0.5) {
      mins[s] = 200;
      continue;
    }
    mins[s] = Math.max(1, Math.min(200, sum[s] + frag[s] + randInt(rng, -6, 14)));
  }
  return { chosen, sum, frag, mods, mins };
}

/** Unpruned walk of the searcher's tree: same default-first order, same branch rule. */
function reference(c: Case, mode: "maximize" | "feasible"): TuningOutcome | null {
  const { chosen, sum, frag, mods, mins } = c;
  const aug = new Array(NUM_STATS).fill(0);
  const applied: (AppliedTuning | null)[] = new Array(NUM_SLOTS).fill(null);
  const suffixDown: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );
  for (let i = NUM_SLOTS - 1; i >= 0; i--) {
    for (let s = 0; s < NUM_STATS; s++) {
      suffixDown[i][s] = suffixDown[i + 1][s] + chosen[i].tuneStatDownside[s];
    }
  }
  let best: TuningOutcome | null = null;
  const leaf = (): void => {
    const deficits = aug.map((v, s) => minShortfall(mins[s], v));
    const asg = assignMods(deficits, mods.major, mods.minor, 0);
    if (!asg) return;
    let total = 0;
    const stats = new Array(NUM_STATS).fill(0);
    for (let s = 0; s < NUM_STATS; s++) {
      stats[s] = clamp(aug[s] + asg.points[s]);
      total += stats[s];
    }
    if (best && total <= best.total) return;
    best = {
      total,
      stats,
      tuningBonus: aug.map((v, s) => v - sum[s] - frag[s]),
      applied: applied.slice(),
      modBonus: asg.points.slice(),
      modsUsed: { major: asg.usedMajor, minor: asg.usedMinor },
      artificeBonus: [0, 0, 0, 0, 0, 0],
      artifice: [null, null, null, null, null],
    };
  };
  // Fast path: every piece on its default option.
  for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
  for (let i = 0; i < NUM_SLOTS; i++) {
    const def = chosen[i].tuneOpts[0];
    applied[i] = def.applied;
    for (let s = 0; s < NUM_STATS; s++) aug[s] += def.vec[s];
  }
  leaf();
  if (best) return best;
  for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
  const rec = (i: number): void => {
    if (mode === "feasible" && best) return;
    if (i === NUM_SLOTS) {
      leaf();
      return;
    }
    const opts = chosen[i].tuneOpts;
    const def = opts[0].vec;
    for (const opt of opts) {
      if (mode === "feasible" && best) return;
      const ap = opt.applied;
      if (ap !== null && ap.kind === "directional") {
        const m = mins[ap.plus];
        if (m <= 0 || aug[ap.plus] + def[ap.plus] + suffixDown[i + 1][ap.plus] >= m) continue;
      }
      applied[i] = opt.applied;
      for (let s = 0; s < NUM_STATS; s++) aug[s] += opt.vec[s];
      rec(i + 1);
      for (let s = 0; s < NUM_STATS; s++) aug[s] -= opt.vec[s];
    }
  };
  rec(0);
  return best;
}

describe("leaf tuner pruning is invisible", () => {
  test("maximize returns the unpruned walk's first maximum on 400 random loadouts", () => {
    const rng = mulberry32(0x7e57ed);
    let slowPathCases = 0;
    let directionalWinners = 0;
    for (let iter = 0; iter < 400; iter++) {
      const c = randomCase(rng);
      const ctx = `iter=${iter} mins=${c.mins} frag=${c.frag} mods=${JSON.stringify(c.mods)} exotic=${c.chosen.findIndex((p) => p.exotic)}`;
      const searcher = createTuningSearcher(c.frag, c.mods);
      const got = searcher(c.chosen, c.sum, c.mins, "maximize");
      const want = reference(c, "maximize");
      expect(got, ctx).toEqual(want);
      if (want && want.applied.some((a) => a?.kind === "directional")) {
        slowPathCases++;
        directionalWinners++;
      } else if (want === null) {
        slowPathCases++;
      }
    }
    // The property is vacuous if the fast path always answers.
    expect(slowPathCases).toBeGreaterThan(80);
    expect(directionalWinners).toBeGreaterThan(40);
  });

  test("feasible mode returns the unpruned walk's first feasible leaf", () => {
    const rng = mulberry32(0xfea51b);
    let found = 0;
    for (let iter = 0; iter < 400; iter++) {
      const c = randomCase(rng);
      const ctx = `iter=${iter} mins=${c.mins} frag=${c.frag} mods=${JSON.stringify(c.mods)}`;
      const searcher = createTuningSearcher(c.frag, c.mods);
      const got = searcher(c.chosen, c.sum, c.mins, "feasible");
      const want = reference(c, "feasible");
      expect(got, ctx).toEqual(want);
      if (want) found++;
    }
    expect(found).toBeGreaterThan(100);
  });
});
