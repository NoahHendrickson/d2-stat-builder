import { describe, expect, test } from "vitest";
import { solve, solveCeilings } from "./solve";
import type { OptimizerInput, OptimizerPiece } from "./types";
import { realWarlockSlots } from "./real-pool.fixture";

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

  test("ceilingsExact: proven on easy pools, false when refinement runs out of budget", () => {
    // Single-loadout pool: optimistic bounds equal the seeds, nothing to probe — exact.
    const easy = solve(
      input([
        [piece("h", [30, 0, 0, 0, 0, 0])],
        [piece("a", [0, 20, 0, 0, 0, 0])],
        [piece("c", [0, 0, 10, 0, 0, 0])],
        [piece("l", [0, 0, 0, 40, 0, 0])],
        [piece("ci", [0, 0, 0, 0, 15, 0])],
      ]),
    );
    expect(easy.ceilingsExact).toBe(true);

    // Real pool with tight targets and a ~1ms refinement budget: probes can't settle,
    // so the ceilings are lower bounds and MUST NOT be flagged proven.
    const hard = solve(
      {
        slots: realWarlockSlots(),
        minimums: [190, 0, 0, 120, 0, 0],
        mods: { major: 3, minor: 2 },
        setRequirements: [{ setHash: 1490136267, count: 4 }],
        allowTuning: true,
        fragmentBonus: [0, 0, 10, -20, 0, 0],
      },
      { topNBudgetMs: 500, ceilingBudgetMs: 1 },
    );
    expect(hard.ceilingsExact).toBe(false);
  });

  test("ceilingSeed floors the seeds (trusted as proven-achievable)", () => {
    const slots = [
      [piece("h", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("c", [0, 0, 10, 0, 0, 0])],
      [piece("l", [0, 0, 0, 40, 0, 0])],
      [piece("ci", [0, 0, 0, 0, 15, 0])],
    ];
    // Budget 0 → ceilings ARE the seeds. The seed takes max(loadout-derived, ceilingSeed)
    // per stat: weapons is lifted to the trusted 33, health keeps its own better 20.
    const out = solve(input(slots), {
      ceilingBudgetMs: 0,
      ceilingSeed: [33, 5, 0, 0, 0, 0],
    });
    expect(out.ceilings).toEqual([33, 20, 10, 40, 15, 0]);
  });

  test("a slow stat's refinement can't starve the stats after it (real-pool regression)", () => {
    // Noah's real Warlock pool with his exact selections (weapon ≥ 180, grenade ≥ 110,
    // CODA 4pc, 3 major + 2 minor mods, Solar fragments = class +10 / grenade −20).
    // Weapon-180 + grenade-135 builds exist in this pool, but the health ceiling probe
    // alone blows the whole refinement budget; sequential refinement aborted everything
    // after it and reported grenade's seed (110 — the user's own target) as its max.
    const out = solve(
      {
        slots: realWarlockSlots(),
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

  test("solveCeilings reports probe stats consistent with its own counting", () => {
    // A tiny pool: one probe per stat that needs refining, all trivially feasible.
    const slots = [
      [piece("h", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("c", [0, 0, 10, 0, 0, 0])],
      [piece("l", [0, 0, 0, 40, 0, 0])],
      [piece("ci", [0, 0, 0, 0, 15, 0])],
    ];
    const seed = [0, 0, 0, 0, 0, 0];
    const { stats } = solveCeilings(
      { slots, minimums: [0, 0, 0, 0, 0, 0], mods: { major: 0, minor: 0 }, allowTuning: false },
      seed,
      1000,
    );
    expect(stats.probes).toBeGreaterThan(0);
    expect(stats.feasible + stats.disproven + stats.timedOut).toBe(stats.probes);
    expect(stats.nodes).toBeGreaterThan(0);
  });
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

describe("legacy exotics (artifice +3)", () => {
  /** An artifice legacy exotic: no tuning, free +3 any-stat mod. */
  function legacyExotic(id: string, stats: number[]): OptimizerPiece {
    return { id, stats, exotic: true, hash: 999, artifice: true };
  }

  test("a build's artifice +3 lands in artificeBonus and the piece's slot pick", () => {
    const slots = [
      [legacyExotic("x", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("b", [0, 0, 10, 0, 0, 0])],
      [piece("c", [0, 0, 0, 40, 0, 0])],
      [piece("d", [0, 0, 0, 0, 15, 0])],
    ];
    const out = solve(input(slots));
    expect(out.loadouts.length).toBe(1);
    const lo = out.loadouts[0];
    expect(lo.artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
    expect(lo.artifice[0]).not.toBeNull();
    expect(lo.artifice.slice(1)).toEqual([null, null, null, null]);
    expect(lo.total).toBe(30 + 20 + 10 + 40 + 15 + 3);
  });

  test("artifice closes a minimum the mod budget can't (feasibility, not just total)", () => {
    const slots = [
      [legacyExotic("x", [10, 0, 0, 0, 0, 0]), piece("p", [10, 0, 0, 0, 0, 0])],
      [piece("a", [0, 0, 0, 0, 0, 0])],
      [piece("b", [0, 0, 0, 0, 0, 0])],
      [piece("c", [0, 0, 0, 0, 0, 0])],
      [piece("d", [0, 0, 0, 0, 0, 0])],
    ];
    // Needs 23 weapons: base 10 + major 10 + artifice 3. The plain piece can't.
    const out = solve(
      input(slots, { minimums: [23, 0, 0, 0, 0, 0], mods: { major: 1, minor: 0 } }),
    );
    expect(out.loadouts.length).toBe(1);
    expect(out.loadouts[0].pieceIds[0]).toBe("x");
  });

  test("an artifice piece raises every stat's ceiling by 3", () => {
    const mk = (artifice: boolean) => [
      [
        artifice
          ? legacyExotic("x", [30, 0, 0, 0, 0, 0])
          : piece("x", [30, 0, 0, 0, 0, 0]),
      ],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("b", [0, 0, 10, 0, 0, 0])],
      [piece("c", [0, 0, 0, 40, 0, 0])],
      [piece("d", [0, 0, 0, 0, 15, 0])],
    ];
    const plain = solve(input(mk(false)));
    const art = solve(input(mk(true)));
    for (let s = 0; s < 6; s++) {
      expect(art.ceilings[s]).toBe(plain.ceilings[s] + 3);
    }
  });

  test("dedupe keeps an artifice piece distinct from a stat-identical plain piece", () => {
    const slots = [
      [
        { id: "plain", stats: [30, 0, 0, 0, 0, 0], exotic: true, hash: 999 },
        legacyExotic("art", [30, 0, 0, 0, 0, 0]),
      ],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("b", [0, 0, 10, 0, 0, 0])],
      [piece("c", [0, 0, 0, 40, 0, 0])],
      [piece("d", [0, 0, 0, 0, 15, 0])],
    ] as OptimizerPiece[][];
    const out = solve(input(slots));
    // If dedupe collapsed them the artifice version could be lost; the best build
    // must carry the +3.
    expect(out.loadouts[0].artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

// These pin the dedupe grouping semantics: pieces that differ in exotic-ness,
// artifice, set membership, or tuning must never collapse into (or shadow) each other,
// even when one has strictly better stats.
describe("dedupe grouping", () => {
  const zeros = (id: string): OptimizerPiece => piece(id, [0, 0, 0, 0, 0, 0]);
  const restSlots = [[zeros("a")], [zeros("b")], [zeros("c")], [zeros("d")]];

  test("a stat-better legendary never eliminates a required exotic", () => {
    const slots = [
      [
        piece("leg", [30, 10, 0, 0, 0, 0]),
        { id: "exo", stats: [20, 5, 0, 0, 0, 0], exotic: true, hash: 42 },
      ],
      ...restSlots,
    ] as OptimizerPiece[][];
    const out = solve(input(slots, { exotic: { mode: "require" } }));
    expect(out.loadouts.length).toBeGreaterThan(0);
    expect(out.loadouts[0].pieceIds[0]).toBe("exo");
  });

  test("a stat-worse artifice piece survives a better plain piece", () => {
    const slots = [
      [
        piece("plain", [30, 0, 0, 0, 0, 0]),
        { id: "art", stats: [28, 0, 0, 0, 0, 0], exotic: false, artifice: true },
      ],
      ...restSlots,
    ] as OptimizerPiece[][];
    // Weapons 31 is only reachable as art's 28 + its free artifice +3; plain caps at 30.
    const out = solve(input(slots, { minimums: [31, 0, 0, 0, 0, 0] }));
    expect(out.loadouts.length).toBe(1);
    expect(out.loadouts[0].pieceIds[0]).toBe("art");
  });

  test("a stat-worse piece with a different tuned stat survives while tuning is on", () => {
    const tunedSuper: OptimizerPiece = {
      id: "ts",
      stats: [10, 5, 5, 0, 25, 0],
      exotic: false,
      tuning: { tuned: 4, offStats: [1, 2, 3] },
    };
    const tunedWeapons: OptimizerPiece = {
      id: "tw",
      stats: [12, 6, 6, 0, 25, 0], // dominates ts on raw stats
      exotic: false,
      tuning: { tuned: 0, offStats: [1, 2, 3] },
    };
    const slots = [[tunedSuper, tunedWeapons], ...restSlots] as OptimizerPiece[][];
    // Super 30 needs a directional +5 into super — only ts is tuned to super.
    const on = solve(input(slots, { allowTuning: true, minimums: [0, 0, 0, 0, 30, 0] }));
    expect(on.loadouts.length).toBeGreaterThan(0);
    expect(on.loadouts[0].pieceIds[0]).toBe("ts");
  });

  test("a stat-worse set piece is still found when its set is required", () => {
    const slots = [
      [piece("noset", [30, 0, 0, 0, 0, 0]), { ...piece("coda", [10, 0, 0, 0, 0, 0]), setHash: 7 }],
      ...restSlots,
    ] as OptimizerPiece[][];
    const withReq = solve(
      input(slots, { setRequirements: [{ setHash: 7, count: 1 }] }),
    );
    expect(withReq.loadouts.length).toBeGreaterThan(0);
    expect(withReq.loadouts[0].pieceIds[0]).toBe("coda");
  });
});

describe("exotic pre-filter", () => {
  const exo = (id: string, hash: number, stats: number[]): OptimizerPiece => ({
    id,
    stats,
    exotic: true,
    hash,
  });
  const mixedSlots = (): OptimizerPiece[][] => [
    [piece("h1", [30, 0, 0, 0, 0, 0]), exo("xh", 1, [40, 0, 0, 0, 0, 0])],
    [piece("a1", [0, 20, 0, 0, 0, 0]), exo("xa", 2, [0, 30, 0, 0, 0, 0])],
    [piece("c1", [0, 0, 10, 0, 0, 0])],
    [piece("l1", [0, 0, 0, 40, 0, 0])],
    [piece("k1", [0, 0, 0, 0, 15, 0])],
  ];
  const strip = (
    slots: OptimizerPiece[][],
    keep: (p: OptimizerPiece) => boolean,
  ): OptimizerPiece[][] => slots.map((s) => s.filter(keep));

  test("mode none behaves exactly like a pool with no exotics", () => {
    const filtered = solve(input(mixedSlots(), { exotic: { mode: "none" } }));
    const stripped = solve(input(strip(mixedSlots(), (p) => !p.exotic)));
    expect(filtered.loadouts.map((l) => l.total)).toEqual(
      stripped.loadouts.map((l) => l.total),
    );
    expect(filtered.ceilings).toEqual(stripped.ceilings);
    // Identical pool after the pre-filter → identical walk, not merely equal results.
    expect(filtered.combosTried).toBe(stripped.combosTried);
  });

  test("mode specific behaves exactly like a pool holding only the chosen exotic", () => {
    const cfg = { exotic: { mode: "specific" as const, hashes: [1] } };
    const filtered = solve(input(mixedSlots(), cfg));
    const stripped = solve(
      input(strip(mixedSlots(), (p) => !p.exotic || p.hash === 1), cfg),
    );
    expect(filtered.loadouts.map((l) => l.total)).toEqual(
      stripped.loadouts.map((l) => l.total),
    );
    expect(filtered.ceilings).toEqual(stripped.ceilings);
    expect(filtered.combosTried).toBe(stripped.combosTried);
    // The chosen exotic is still found and used.
    expect(filtered.loadouts.length).toBeGreaterThan(0);
    expect(filtered.loadouts[0].pieceIds[0]).toBe("xh");
  });
});

/**
 * D2ArmorPicker parity regression (Noah's real case, 2026-07-02): legacy Verity's Brow
 * (+2-all-six masterwork assumption, artifice) + four CODA Tier-5 pieces must reach
 * weapon >= 147 while holding grenade >= 170 with 3 majors + 2 minors. Before the
 * legacy masterwork fix, Verity's normalized 2 low on its high stats and the app
 * reported a weapon ceiling of 145.
 */
test("legacy Verity's Brow reaches weapon 147+ at grenade 170 (D2AP parity)", () => {
  const slots: OptimizerPiece[][] = [
    [{ id: "verity", stats: [17, 4, 19, 32, 4, 4], exotic: true, hash: 999, artifice: true }],
    [{ id: "wraps", stats: [30, 20, 5, 25, 5, 5], exotic: false, tuning: { tuned: 0, offStats: [2, 4, 5] } }],
    [{ id: "robes", stats: [30, 5, 20, 25, 5, 5], exotic: false, tuning: { tuned: 0, offStats: [1, 4, 5] } }],
    [{ id: "treads", stats: [30, 5, 20, 25, 5, 5], exotic: false, tuning: { tuned: 3, offStats: [1, 4, 5] } }],
    [{ id: "bond", stats: [30, 5, 5, 25, 20, 5], exotic: false, tuning: { tuned: 3, offStats: [1, 2, 5] } }],
  ];
  const at = solve(
    input(slots, {
      minimums: [147, 0, 0, 170, 0, 0],
      mods: { major: 3, minor: 2 },
      allowTuning: true,
    }),
  );
  expect(at.loadouts.length).toBeGreaterThan(0);

  const ceil = solve(
    input(slots, {
      minimums: [0, 0, 0, 170, 0, 0],
      mods: { major: 3, minor: 2 },
      allowTuning: true,
    }),
  );
  expect(ceil.ceilings[0]).toBeGreaterThanOrEqual(147);
});
