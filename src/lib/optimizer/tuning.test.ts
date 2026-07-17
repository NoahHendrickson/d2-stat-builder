import { describe, expect, test } from "vitest";
import {
  assignMods,
  createTuningSearcher,
  directionalsBranchable,
  makeInternalPiece,
  minShortfall,
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
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
    });
  });

  test("exact major fit: a 10-point deficit takes one major", () => {
    const out = assignMods([10, 0, 0, 0, 0, 0], 1, 0);
    expect(out).toEqual({
      points: [10, 0, 0, 0, 0, 0],
      usedMajor: 1,
      usedMinor: 0,
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
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
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
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
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
    });
  });

  test("exact-budget boundary: needs every mod, one more point breaks it", () => {
    // 3 majors + 2 minors = 40 points, exactly covering 10+10+10+5+5.
    const out = assignMods([10, 10, 10, 5, 5, 0], 3, 2);
    expect(out).toEqual({
      points: [10, 10, 10, 5, 5, 0],
      usedMajor: 3,
      usedMinor: 2,
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
    });
    expect(assignMods([10, 10, 10, 5, 5, 5], 3, 2)).toBeNull();
  });

  test("artifice: a 3-point deficit is covered by one artifice mod, zero stat mods", () => {
    const out = assignMods([3, 0, 0, 0, 0, 0], 0, 0, 1);
    expect(out).toEqual({
      points: [0, 0, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 0,
      artificePoints: [3, 0, 0, 0, 0, 0],
      usedArtifice: 1,
    });
  });

  test("artifice unlocks a deficit the mod budget alone can't cover", () => {
    // 13 needs 10+3: one major + one artifice. Without artifice it's null.
    expect(assignMods([13, 0, 0, 0, 0, 0], 1, 0, 0)).toBeNull();
    const out = assignMods([13, 0, 0, 0, 0, 0], 1, 0, 1);
    expect(out).toEqual({
      points: [10, 0, 0, 0, 0, 0],
      usedMajor: 1,
      usedMinor: 0,
      artificePoints: [3, 0, 0, 0, 0, 0],
      usedArtifice: 1,
    });
  });

  test("mods are preferred over artifice when either could cover", () => {
    // One minor (+5) covers the 5-point deficit; the artifice mod stays unspent
    // (worth more later as a full +3 to the maximize dump).
    const out = assignMods([5, 0, 0, 0, 0, 0], 0, 1, 1);
    expect(out).toEqual({
      points: [5, 0, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 1,
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
    });
  });

  test("backtracking across resources: artifice must move to the stat mods can't reach", () => {
    // Budget: 1 minor + 1 artifice. Deficits [3, 5]: the minor must go to stat 1
    // (5 > 3 points), artifice to stat 0 — a minor-on-0 greedy would strand stat 1.
    const out = assignMods([3, 5, 0, 0, 0, 0], 0, 1, 1);
    expect(out).toEqual({
      points: [0, 5, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 1,
      artificePoints: [3, 0, 0, 0, 0, 0],
      usedArtifice: 1,
    });
  });

  test("infeasible even with artifice", () => {
    expect(assignMods([9, 0, 0, 0, 0, 0], 0, 1, 1)).toBeNull(); // 5+3=8 < 9
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
        makeInternalPiece(randomPiece(rnd, `p${i}`, i === exoticSlot), true, true),
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

describe("artifice in the tuning searcher", () => {
  const ZERO6 = [0, 0, 0, 0, 0, 0];

  function internal(p: Partial<OptimizerPiece> & { id: string }): InternalPiece {
    return makeInternalPiece({ stats: ZERO6.slice(), exotic: false, ...p }, true, true);
  }

  /** 5 plain pieces, the first optionally artifice. */
  function loadout(artifice: boolean): InternalPiece[] {
    return [
      internal({ id: "x", artifice, exotic: artifice }),
      internal({ id: "a" }),
      internal({ id: "b" }),
      internal({ id: "c" }),
      internal({ id: "d" }),
    ];
  }

  test("maximize: an artifice piece's +3 is always spent (dump raises total by 3)", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 0, minor: 0 });
    const sum = [10, 10, 10, 10, 10, 10];
    const plain = search(loadout(false), sum, ZERO6.slice(), "maximize");
    const art = search(loadout(true), sum, ZERO6.slice(), "maximize");
    expect(plain).not.toBeNull();
    expect(art).not.toBeNull();
    expect(art!.total).toBe(plain!.total + 3);
    expect(art!.artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
    // Slot 0 is the artifice piece; its pick names the dumped stat.
    expect(art!.artifice[0]).not.toBeNull();
    expect(art!.artifice.slice(1)).toEqual([null, null, null, null]);
  });

  test("feasible: artifice closes a minimum the mod budget alone cannot", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 1, minor: 0 });
    const sum = [10, 0, 0, 0, 0, 0];
    const mins = [23, 0, 0, 0, 0, 0]; // needs 13 over base: 10 (major) + 3 (artifice)
    expect(search(loadout(false), sum, mins.slice(), "feasible")).toBeNull();
    const out = search(loadout(true), sum, mins.slice(), "feasible");
    expect(out).not.toBeNull();
    expect(out!.stats[0]).toBeGreaterThanOrEqual(23);
    expect(out!.artificeBonus[0]).toBe(3);
    expect(out!.artifice[0]).toBe(0);
  });

  test("maximize: dump respects the 200 cap (picks a stat with headroom)", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 0, minor: 0 });
    const sum = [200, 200, 200, 200, 200, 50];
    const out = search(loadout(true), sum, ZERO6.slice(), "maximize");
    expect(out).not.toBeNull();
    expect(out!.artifice[0]).toBe(5); // only stat 5 has headroom
    expect(out!.stats[5]).toBe(53);
  });

  test("no artifice pieces: outcome carries zero artifice fields (regression shape)", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 0, minor: 0 });
    const out = search(loadout(false), [10, 0, 0, 0, 0, 0], ZERO6.slice(), "maximize");
    expect(out!.artificeBonus).toEqual(ZERO6);
    expect(out!.artifice).toEqual([null, null, null, null, null]);
  });
});

describe("minShortfall (the canonical zero-min / clamp rule)", () => {
  test("a zero minimum is always met, even from a negative pre-clamp value", () => {
    expect(minShortfall(0, -5)).toBe(0);
    expect(minShortfall(0, 0)).toBe(0);
    expect(minShortfall(0, 50)).toBe(0);
  });

  test("a positive minimum charges the raw gap, floored at zero", () => {
    expect(minShortfall(30, 25)).toBe(5);
    expect(minShortfall(30, -5)).toBe(35); // real cost: the clamp doesn't help above 0
    expect(minShortfall(30, 30)).toBe(0);
    expect(minShortfall(30, 40)).toBe(0);
  });
});

describe("directionalsBranchable (shared searcher/bound policy)", () => {
  const short = (arr: boolean[]) => (s: number) => arr[s];

  test("legendary: only its rolled tuned stat qualifies", () => {
    expect(
      directionalsBranchable(false, 2, short([true, false, false, false, false, false])),
    ).toBe(false);
    expect(
      directionalsBranchable(false, 2, short([false, false, true, false, false, false])),
    ).toBe(true);
    // Untunable piece (tuned = -1) never branches.
    expect(directionalsBranchable(false, -1, short([true, true, true, true, true, true]))).toBe(
      false,
    );
  });

  test("exotic: any short stat qualifies (flexible +5)", () => {
    expect(
      directionalsBranchable(true, 2, short([false, false, false, false, false, true])),
    ).toBe(true);
    expect(
      directionalsBranchable(true, 2, short([false, false, false, false, false, false])),
    ).toBe(false);
  });
});
