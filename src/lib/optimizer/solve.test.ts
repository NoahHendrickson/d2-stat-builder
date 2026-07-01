import { describe, expect, test } from "vitest";
import { solve } from "./solve";
import type { OptimizerInput, OptimizerPiece } from "./types";
import { REAL_WARLOCK_POOL } from "./real-pool.fixture";

/** A tuning-free, set-free piece — stats sum straight into the loadout total. */
function piece(id: string, stats: number[]): OptimizerPiece {
  return { id, stats, exotic: false };
}

/** Base input: no mods, no tuning, no set/exotic constraints, all minimums 0. */
function input(
  slots: OptimizerPiece[][],
  overrides: Partial<OptimizerInput> = {},
): OptimizerInput {
  return {
    slots,
    minimums: [0, 0, 0, 0, 0, 0],
    mods: { major: 0, minor: 0 },
    allowTuning: false,
    ...overrides,
  };
}

describe("per-stat ceilings", () => {
  test("single-loadout pool: ceilings equal that loadout's per-stat totals", () => {
    const slots = [
      [piece("h", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("c", [0, 0, 10, 0, 0, 0])],
      [piece("l", [0, 0, 0, 40, 0, 0])],
      [piece("ci", [0, 0, 0, 0, 15, 0])],
    ];
    const out = solve(input(slots));
    expect(out.ceilings).toEqual([30, 20, 10, 40, 15, 0]);
  });

  test("ceilings come from their own search, not the returned top-N loadouts", () => {
    const slots = [
      [piece("x", [100, 0, 0, 0, 0, 0]), piece("y", [0, 50, 50, 50, 0, 0])],
      [piece("a1", [0, 10, 10, 10, 0, 0])],
      [piece("a2", [0, 10, 10, 10, 0, 0])],
      [piece("a3", [0, 10, 10, 10, 0, 0])],
      [piece("a4", [0, 10, 10, 10, 0, 0])],
    ];
    const out = solve(input(slots, { maxResults: 1 }));
    // The single highest-total loadout uses "y" (total 270) and has 0 weapons…
    expect(out.loadouts[0].stats[0]).toBe(0);
    // …yet the weapons ceiling reflects the low-total "x" build (weapons 100).
    expect(out.ceilings).toEqual([100, 90, 90, 90, 0, 0]);
  });

  test("each ceiling is achievable and tight (ceiling ok, ceiling+1 impossible)", () => {
    const slots = [
      [piece("x", [100, 0, 0, 0, 0, 0]), piece("y", [0, 50, 50, 50, 0, 0])],
      [piece("a1", [0, 10, 10, 10, 0, 0])],
      [piece("a2", [0, 10, 10, 10, 0, 0])],
      [piece("a3", [0, 10, 10, 10, 0, 0])],
      [piece("a4", [0, 10, 10, 10, 0, 0])],
    ];
    const cap = solve(input(slots)).ceilings[0]; // weapons ceiling
    expect(cap).toBe(100);
    const at = solve(input(slots, { minimums: [cap, 0, 0, 0, 0, 0] }));
    expect(at.loadouts.length).toBeGreaterThan(0);
    const above = solve(input(slots, { minimums: [cap + 1, 0, 0, 0, 0, 0] }));
    expect(above.loadouts.length).toBe(0);
  });

  test("locking a stat's minimum shrinks the other stats' ceilings", () => {
    // Each slot trades 20 weapons vs 20 health.
    const ab = [
      [piece("h0", [20, 0, 0, 0, 0, 0]), piece("h1", [0, 20, 0, 0, 0, 0])],
      [piece("a0", [20, 0, 0, 0, 0, 0]), piece("a1", [0, 20, 0, 0, 0, 0])],
      [piece("c0", [20, 0, 0, 0, 0, 0]), piece("c1", [0, 20, 0, 0, 0, 0])],
      [piece("l0", [20, 0, 0, 0, 0, 0]), piece("l1", [0, 20, 0, 0, 0, 0])],
      [piece("k0", [20, 0, 0, 0, 0, 0]), piece("k1", [0, 20, 0, 0, 0, 0])],
    ];
    const free = solve(input(ab)).ceilings[0];
    expect(free).toBe(100); // all five slots pick weapons
    // Demand health ≥ 40 → 2 slots forced to health, leaving 3 for weapons.
    const out = solve(input(ab, { minimums: [0, 40, 0, 0, 0, 0] }));
    expect(out.ceilings[0]).toBe(60);
    expect(out.ceilings[0]).toBeLessThan(free);
    // The locked stat's own ceiling relaxes its own minimum: health could still reach 100.
    expect(out.ceilings[1]).toBe(100);
  });

  test("an unreachable minimum zeroes other ceilings but not the over-set stat's own", () => {
    // Every piece gives +10 super; super maxes at 50 across 5 slots.
    const slots = [
      [piece("h0", [20, 0, 0, 0, 10, 0]), piece("h1", [0, 20, 0, 0, 10, 0])],
      [piece("a0", [20, 0, 0, 0, 10, 0]), piece("a1", [0, 20, 0, 0, 10, 0])],
      [piece("c0", [20, 0, 0, 0, 10, 0]), piece("c1", [0, 20, 0, 0, 10, 0])],
      [piece("l0", [20, 0, 0, 0, 10, 0]), piece("l1", [0, 20, 0, 0, 10, 0])],
      [piece("k0", [20, 0, 0, 0, 10, 0]), piece("k1", [0, 20, 0, 0, 10, 0])],
    ];
    // super ≥ 999 is impossible (max 50): no build meets the minimums.
    const out = solve(input(slots, { minimums: [0, 0, 0, 0, 999, 0] }));
    expect(out.loadouts.length).toBe(0);
    // Each stat's ceiling relaxes its OWN minimum: super can still reach 50, but every
    // other stat is capped at 0 because it must satisfy the impossible super ≥ 999.
    expect(out.ceilings).toEqual([0, 0, 0, 0, 50, 0]);
  });

  test("leftover mod points lift a stat's ceiling after other minimums are covered", () => {
    const slots = [
      [piece("h", [50, 0, 0, 0, 0, 0])],
      [piece("a", [0, 100, 0, 0, 0, 0])],
      [piece("c", [0, 0, 0, 0, 0, 0])],
      [piece("l", [0, 0, 0, 0, 0, 0])],
      [piece("k", [0, 0, 0, 0, 0, 0])],
    ];
    // 5 major mods = +50 points, all assignable to one stat when others need none.
    const out = solve(input(slots, { mods: { major: 5, minor: 0 } }));
    expect(out.ceilings).toEqual([100, 150, 50, 50, 50, 50]);
  });

  test("directional tuning raises a stat's ceiling, and stays consistent with solve", () => {
    // Tunable piece: base weapons 30, and a health of 5 to absorb the directional −5.
    const tunable: OptimizerPiece = {
      id: "t",
      stats: [30, 5, 0, 0, 0, 0],
      exotic: false,
      tuning: { tuned: 0, offStats: [2, 3, 4] },
    };
    const slots = [
      [tunable],
      [piece("a", [0, 0, 0, 0, 0, 0])],
      [piece("b", [0, 0, 0, 0, 0, 0])],
      [piece("c", [0, 0, 0, 0, 0, 0])],
      [piece("d", [0, 0, 0, 0, 0, 0])],
    ];
    // Directional (+5 weapons, −5 health: 5→0) lifts the weapons ceiling from 30 to 35.
    const out = solve(input(slots, { allowTuning: true }));
    expect(out.ceilings[0]).toBe(35);
    // …and solve can actually deliver weapons 35 but not 36 (ceiling is achievable + tight).
    expect(
      solve(input(slots, { allowTuning: true, minimums: [35, 0, 0, 0, 0, 0] }))
        .loadouts.length,
    ).toBeGreaterThan(0);
    expect(
      solve(input(slots, { allowTuning: true, minimums: [36, 0, 0, 0, 0, 0] }))
        .loadouts.length,
    ).toBe(0);
  });

  test("stays within the time budget on a large, tightly-constrained tunable pool", () => {
    // A big Tier-5 pool with high minimums is the worst case for exact ceilings; the
    // budget must keep it responsive (results/ceilings are seeded + best-effort refined).
    const arche: [number, number, number][] = [];
    for (let a = 0; a < 6; a++)
      for (let b = a + 1; b < 6; b++)
        for (let c = b + 1; c < 6; c++) arche.push([a, b, c]);
    const bigSlot = (prefix: string): OptimizerPiece[] =>
      Array.from({ length: 18 }, (_, i) => {
        const tri = arche[i % arche.length];
        const off = [0, 1, 2, 3, 4, 5].filter((x) => !tri.includes(x));
        const stats = [5, 5, 5, 5, 5, 5];
        stats[tri[0]] = 30;
        stats[tri[1]] = 25;
        stats[tri[2]] = 20;
        return { id: `${prefix}${i}`, stats, exotic: false, tuning: { tuned: off[i % off.length], offStats: off } };
      });
    const slots = [0, 1, 2, 3, 4].map((i) => bigSlot(`s${i}`));
    const start = performance.now();
    const out = solve(
      input(slots, { allowTuning: true, mods: { major: 1, minor: 4 }, minimums: [120, 100, 50, 0, 0, 0] }),
    );
    const ms = performance.now() - start;
    expect(out.ceilings).toHaveLength(6);
    expect(ms).toBeLessThan(3000); // budget is 1200ms + the (fast) top-N search
  });
});

describe("ceiling refinement", () => {
  test("seeds include leftover mod capacity, not just target-covering mods", () => {
    // Five identical weapons-10 pieces; weapons 60 forces 1 major, leaving 1 major spare.
    // With no refinement budget the ceilings ARE the seeds — they must reflect that the
    // spare major could be socketed into any one stat, not just echo the targets back.
    const slots = [
      [piece("h", [10, 0, 0, 0, 0, 0])],
      [piece("a", [10, 0, 0, 0, 0, 0])],
      [piece("c", [10, 0, 0, 0, 0, 0])],
      [piece("l", [10, 0, 0, 0, 0, 0])],
      [piece("k", [10, 0, 0, 0, 0, 0])],
    ];
    const out = solve(
      input(slots, { mods: { major: 2, minor: 0 }, minimums: [60, 0, 0, 0, 0, 0] }),
      { ceilingBudgetMs: 0 },
    );
    // Build: weapons 50 + 1 major = 60; the spare major lifts every stat's seed by 10.
    expect(out.ceilings).toEqual([70, 10, 10, 10, 10, 10]);
  });

  test("a slow stat's refinement can't starve the stats after it (real-pool regression)", () => {
    // Noah's real Warlock pool with his exact selections (weapon ≥ 180, grenade ≥ 110,
    // CODA 4pc, 3 major + 2 minor mods, Solar fragments = class +10 / grenade −20).
    // Weapon-180 + grenade-135 builds exist in this pool, but the health ceiling probe
    // alone blows the whole refinement budget; sequential refinement aborted everything
    // after it and reported grenade's seed (110 — the user's own target) as its max.
    const slots = ["helmet", "arms", "chest", "legs", "classItem"].map((slot) =>
      REAL_WARLOCK_POOL.filter((p) => p.slot === slot).map((p, i) => ({
        id: `${slot}${i}`,
        stats: p.stats,
        exotic: p.exo === 1,
        setHash: p.set || undefined,
        tuning: { tuned: p.tuned, offStats: p.off },
      })),
    );
    const out = solve(
      {
        slots,
        minimums: [180, 0, 0, 110, 0, 0],
        mods: { major: 3, minor: 2 },
        setRequirements: [{ setHash: 1490136267, count: 4 }],
        exotic: { mode: "any" },
        allowTuning: true,
        fragmentBonus: [0, 0, 10, -20, 0, 0],
        maxResults: 200,
      },
      { topNBudgetMs: 500 },
    );
    expect(out.ceilings[3]).toBeGreaterThanOrEqual(135); // grenade
  }, 30_000);
});

describe("exotic tuning", () => {
  test("a Tier-5 exotic can tune +5 into any stat, not just its rolled tuned stat", () => {
    // Every piece has super 25 (archetype) → armor super = 125. No legendary is tuned to
    // super, and balanced only lifts off-archetype stats — so super stays 125 unless the
    // exotic (rolled to weapons) uses its flexible slot to put +5 into super, reaching 130.
    const leg = (id: string): OptimizerPiece => ({
      id,
      stats: [30, 5, 5, 5, 25, 5], // weapons 30, super 25, off-arch 5
      exotic: false,
      tuning: { tuned: 0, offStats: [1, 2, 3] }, // rolled to weapons
    });
    const exoticChest: OptimizerPiece = {
      id: "ex",
      stats: [30, 5, 5, 5, 25, 5],
      exotic: true,
      hash: 42,
      tuning: { tuned: 0, offStats: [1, 2, 3] }, // rolled to weapons — NOT super
    };
    const slots = [
      [leg("h")],
      [leg("a")],
      [exoticChest],
      [leg("l")],
      [leg("k")],
    ];
    const out = solve(
      input(slots, {
        allowTuning: true,
        exotic: { mode: "specific", hashes: [42] },
        minimums: [0, 0, 0, 0, 130, 0], // super ≥ 130
      }),
    );
    expect(out.loadouts.length).toBeGreaterThan(0);
    expect(out.loadouts[0].stats[4]).toBeGreaterThanOrEqual(130);
    // The exotic's ceiling for super also reflects the flexible +5 (125 + 5).
    expect(out.ceilings[4]).toBeGreaterThanOrEqual(130);
  });

  test("reproduces the Sanguine + TM-Moss build (weapon 200 + super 130)", () => {
    // Reconstructed from D2ArmorPicker. Stat order [weapons, health, class, grenade,
    // super, melee]. Sanguine is the exotic; its socket's arbitrary first tuned stat is
    // health(1), but its flexible slot must be able to put +5 into super.
    const TM = 77;
    const p = (
      id: string,
      stats: number[],
      tuned: number,
      exotic = false,
    ): OptimizerPiece => {
      const off = [0, 1, 2, 3, 4, 5]
        .slice()
        .sort((a, b) => stats[a] - stats[b])
        .slice(0, 3);
      return {
        id,
        stats,
        exotic,
        hash: exotic ? 42 : undefined,
        setHash: exotic ? undefined : TM,
        tuning: { tuned, offStats: off },
      };
    };
    const slots = [
      [p("hat", [30, 5, 20, 5, 25, 5], 0)], // TM, tuned weapons
      [p("gloves", [30, 5, 5, 20, 25, 5], 2)], // TM, tuned class
      [p("sanguine", [30, 5, 20, 5, 25, 5], 1, true)], // exotic, detected health
      [p("pants", [30, 20, 5, 5, 25, 5], 0)], // TM, tuned weapons
      [p("bond", [30, 5, 5, 20, 25, 5], 1)], // TM, tuned health
    ];
    const out = solve(
      input(slots, {
        allowTuning: true,
        mods: { major: 3, minor: 2 },
        fragmentBonus: [0, 0, 10, -20, 0, 0], // Configuration: class +10, grenade −20
        setRequirements: [{ setHash: TM, count: 4 }],
        exotic: { mode: "specific", hashes: [42] },
        minimums: [200, 0, 0, 0, 130, 0],
      }),
    );
    expect(out.loadouts.length).toBeGreaterThan(0);
    expect(out.loadouts[0].stats[0]).toBeGreaterThanOrEqual(200); // weapons
    expect(out.loadouts[0].stats[4]).toBeGreaterThanOrEqual(130); // super

    // With ONLY weapon 200 required, the super ceiling must still reach 130 (weapon comes
    // from the two legendary weapon tunes, freeing the exotic to put +5 into super).
    const wpnOnly = solve(
      input(slots, {
        allowTuning: true,
        mods: { major: 3, minor: 2 },
        fragmentBonus: [0, 0, 10, -20, 0, 0],
        setRequirements: [{ setHash: TM, count: 4 }],
        exotic: { mode: "specific", hashes: [42] },
        minimums: [200, 0, 0, 0, 0, 0],
      }),
    );
    expect(wpnOnly.ceilings[4]).toBeGreaterThanOrEqual(130); // super ceiling
  });

  test("every reported ceiling is achievable (no over-report from double-counted tuning)", () => {
    // Same Sanguine + TM-Moss build. Regression: the ceiling probe's directional search
    // left the fast path's Balanced tuning in `aug`, so it counted Balanced twice and
    // over-reported. Three pieces carry grenade as an off-archetype stat, so grenade's
    // ceiling read 38 while only 35 is actually reachable with weapon 200 + super 130.
    const TM = 77;
    const p = (
      id: string,
      stats: number[],
      tuned: number,
      exotic = false,
    ): OptimizerPiece => {
      const off = [0, 1, 2, 3, 4, 5]
        .slice()
        .sort((a, b) => stats[a] - stats[b])
        .slice(0, 3);
      return {
        id,
        stats,
        exotic,
        hash: exotic ? 42 : undefined,
        setHash: exotic ? undefined : TM,
        tuning: { tuned, offStats: off },
      };
    };
    const slots = [
      [p("hat", [30, 5, 20, 5, 25, 5], 0)],
      [p("gloves", [30, 5, 5, 20, 25, 5], 2)],
      [p("sanguine", [30, 5, 20, 5, 25, 5], 1, true)],
      [p("pants", [30, 20, 5, 5, 25, 5], 0)],
      [p("bond", [30, 5, 5, 20, 25, 5], 1)],
    ];
    const held = [200, 0, 0, 0, 130, 0]; // weapon 200 + super 130
    const cfg = (minimums: number[]) =>
      input(slots, {
        allowTuning: true,
        mods: { major: 3, minor: 2 },
        fragmentBonus: [0, 0, 10, -20, 0, 0],
        setRequirements: [{ setHash: TM, count: 4 }],
        exotic: { mode: "specific", hashes: [42] },
        minimums,
      });

    const ceilings = solve(cfg(held)).ceilings;
    expect(ceilings[3]).toBe(35); // grenade: the exact stat that regressed
    // Every reported ceiling must be deliverable: hold the others, demand the ceiling.
    for (let s = 0; s < 6; s++) {
      const min = held.slice();
      min[s] = ceilings[s];
      expect(solve(cfg(min)).loadouts.length).toBeGreaterThan(0);
    }
  });
});
