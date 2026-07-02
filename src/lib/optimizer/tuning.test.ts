import { describe, expect, test } from "vitest";
import {
  assignMods,
  createTuningSearcher,
  makeInternalPiece,
  type InternalPiece,
} from "./tuning";
import type { OptimizerPiece } from "./types";

describe("assignMods", () => {
  test("zero deficits: succeeds with no mods used", () => {
    const out = assignMods([0, 0, 0, 0, 0, 0], 3, 2);
    expect(out).toEqual({
      points: [0, 0, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 0,
    });
  });

  test("exact major fit: a 10-point deficit takes one major", () => {
    const out = assignMods([10, 0, 0, 0, 0, 0], 1, 0);
    expect(out).toEqual({
      points: [10, 0, 0, 0, 0, 0],
      usedMajor: 1,
      usedMinor: 0,
    });
  });

  test("mixed major + minor across stats", () => {
    const out = assignMods([15, 10, 0, 0, 0, 0], 2, 1);
    expect(out).not.toBeNull();
    expect(out!.points[0]).toBeGreaterThanOrEqual(15);
    expect(out!.points[1]).toBeGreaterThanOrEqual(10);
    expect(out!.usedMajor).toBe(2);
    expect(out!.usedMinor).toBe(1);
  });

  test("over-coverage from ceil: deficit 3 with one minor yields 5 points", () => {
    const out = assignMods([3, 0, 0, 0, 0, 0], 0, 1);
    expect(out).toEqual({
      points: [5, 0, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 1,
    });
  });

  test("infeasible: deficit exceeds the whole budget", () => {
    expect(assignMods([60, 0, 0, 0, 0, 0], 5, 0)).toBeNull();
    expect(assignMods([10, 10, 0, 0, 0, 0], 1, 0)).toBeNull();
  });

  test("backtracking: greedy major-first on stat 0 fails, must swap", () => {
    // Greedy puts the major on stat 0 (deficit 5), leaving only the minor for
    // stat 1's deficit of 10 — infeasible. The search must backtrack to
    // minor-on-0 / major-on-1.
    const out = assignMods([5, 10, 0, 0, 0, 0], 1, 1);
    expect(out).toEqual({
      points: [5, 10, 0, 0, 0, 0],
      usedMajor: 1,
      usedMinor: 1,
    });
  });

  test("exact-budget boundary: needs every mod, one more point breaks it", () => {
    // 3 majors + 2 minors = 40 points, exactly covering 10+10+10+5+5.
    const out = assignMods([10, 10, 10, 5, 5, 0], 3, 2);
    expect(out).toEqual({
      points: [10, 10, 10, 5, 5, 0],
      usedMajor: 3,
      usedMinor: 2,
    });
    expect(assignMods([10, 10, 10, 5, 5, 5], 3, 2)).toBeNull();
  });
});

describe("maximize/feasible consistency (property)", () => {
  // Deterministic PRNG so a failure is reproducible from the seed.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A random archetype-shaped piece: 3 high stats, 3 low; ~50% tunable. */
  function randomPiece(
    rnd: () => number,
    id: string,
    exotic: boolean,
  ): OptimizerPiece {
    const idx = [0, 1, 2, 3, 4, 5];
    // Fisher–Yates for the 3 archetype stats.
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const tri = idx.slice(0, 3);
    const off = idx.slice(3).sort((a, b) => a - b);
    const stats = [5, 5, 5, 5, 5, 5];
    stats[tri[0]] = 30;
    stats[tri[1]] = 25;
    stats[tri[2]] = 20;
    const tunable = rnd() < 0.5;
    return {
      id,
      stats,
      exotic,
      hash: exotic ? 42 : undefined,
      tuning: tunable
        ? { tuned: off[Math.floor(rnd() * off.length)], offStats: off }
        : undefined,
    };
  }

  test("feasible-mode agrees with maximize-mode on 300 random loadouts", () => {
    const rnd = mulberry32(0xd2a37);
    for (let iter = 0; iter < 300; iter++) {
      const exoticSlot = rnd() < 0.5 ? Math.floor(rnd() * 5) : -1;
      const chosen: InternalPiece[] = Array.from({ length: 5 }, (_, i) =>
        makeInternalPiece(randomPiece(rnd, `p${i}`, i === exoticSlot), true),
      );
      const sum = [0, 0, 0, 0, 0, 0];
      for (const p of chosen) {
        for (let s = 0; s < 6; s++) sum[s] += p.stats[s];
      }
      const frag = Array.from({ length: 6 }, () =>
        rnd() < 0.3 ? Math.floor(rnd() * 5) * 10 - 20 : 0,
      );
      const major = Math.floor(rnd() * 4);
      const mods = { major, minor: Math.floor(rnd() * (6 - major)) };
      // Mix feasible and infeasible: mins centered around the reachable range.
      const mins = Array.from({ length: 6 }, () =>
        rnd() < 0.5 ? 0 : Math.floor(rnd() * 44) * 5,
      );

      const tuner = createTuningSearcher(frag, mods);
      const maxed = tuner(chosen, sum, mins, "maximize");
      const probe = tuner(chosen, sum, mins, "feasible");

      const ctx = `iter ${iter}: mins=${mins} mods=${JSON.stringify(mods)} frag=${frag}`;
      // Existence must agree between the two modes.
      expect(probe === null, ctx).toBe(maxed === null);
      if (maxed) {
        // The maximize winner must actually meet every (clamped) minimum…
        for (let s = 0; s < 6; s++) {
          expect(maxed.stats[s], `${ctx} stat ${s}`).toBeGreaterThanOrEqual(
            Math.min(mins[s], 200),
          );
        }
        // …and be at least as good as whatever the probe stumbled on first.
        expect(maxed.total, ctx).toBeGreaterThanOrEqual(probe!.total);
      }
    }
  });
});
