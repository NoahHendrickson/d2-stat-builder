import { describe, expect, it } from "vitest";
import type { ArmorArchetype } from "../armory/archetypes";
import {
  buildTheorySpace,
  solveTheory,
  type OwnedRoll,
  type TheoryInput,
  type TheoryRecipe,
  type TheorySpace,
} from "./theory";
import { FREE, tuningsNeeded } from "./theory/feasibility";
import { rollUnits, theoryRolls } from "./theory/space";
import { mulberry32 } from "./test-rng";

// The 12 Armor 3.0 archetypes (see dream.test.ts), in STAT_ORDER indices:
// weapons 0, health 1, class 2, grenade 3, super 4, melee 5.
const ARCHETYPES: ArmorArchetype[] = [
  { name: "Gunner", primary: 0, secondary: 3 },
  { name: "Powerhouse", primary: 0, secondary: 4 },
  { name: "Bulwark", primary: 1, secondary: 2 },
  { name: "Siegebreaker", primary: 1, secondary: 3 },
  { name: "Specialist", primary: 2, secondary: 0 },
  { name: "Reaver", primary: 2, secondary: 5 },
  { name: "Demolitionist", primary: 3, secondary: 2 },
  { name: "Grenadier", primary: 3, secondary: 4 },
  { name: "Colossus", primary: 4, secondary: 1 },
  { name: "Paragon", primary: 4, secondary: 5 },
  { name: "Skirmisher", primary: 5, secondary: 0 },
  { name: "Brawler", primary: 5, secondary: 1 },
];

/** Every way to put `n` mods of one size on six stats (as per-stat counts). */
function placements(n: number): number[][] {
  if (n === 0) return [[0, 0, 0, 0, 0, 0]];
  const out: number[][] = [];
  for (const rest of placements(n - 1)) {
    for (let s = 0; s < 6; s++) {
      const p = [...rest];
      p[s]++;
      out.push(p);
    }
  }
  return out;
}

/**
 * Brute force for tuningsNeeded over every mod placement: each unit still short needs its
 * own tuning (at most 5), the units given away can only come from stats with room, and
 * what tuning can't cover is the shortfall. Tunings ≥ 0, or −(fewest units short).
 */
function bruteTuningsNeeded(g: number[], major: number, minor: number): number {
  let tunings = Infinity;
  let shortfall = Infinity;
  for (const mods of modUnits(major, minor)) {
    let short = 0;
    let room = 0;
    for (let s = 0; s < 6; s++) {
      if (g[s] <= FREE) {
        room = Infinity;
        continue;
      }
      const h = g[s] - mods[s];
      if (h > 0) short += h;
      else room += -h;
    }
    const miss = short - Math.min(short, 5, room);
    shortfall = Math.min(shortfall, miss);
    if (miss === 0) tunings = Math.min(tunings, short);
  }
  return shortfall > 0 ? -shortfall : tunings;
}

/** Distinct per-stat mod units over every placement of `major` majors and `minor` minors. */
const modUnitsCache = new Map<string, number[][]>();
function modUnits(major: number, minor: number): number[][] {
  const key = `${major}:${minor}`;
  let out = modUnitsCache.get(key);
  if (!out) {
    const seen = new Map<string, number[]>();
    for (const a of placements(major)) {
      for (const b of placements(minor)) {
        const u = a.map((v, s) => 2 * v + b[s]);
        seen.set(u.join(","), u);
      }
    }
    out = [...seen.values()];
    modUnitsCache.set(key, out);
  }
  return out;
}

describe("tuningsNeeded", () => {
  /** Random needs in −5..range−6 per stat (a fifth of them FREE), checked against the oracle. */
  const check = (seed: number, range: number) => {
    const rng = mulberry32(seed);
    for (let trial = 0; trial < 600; trial++) {
      const g = Array.from({ length: 6 }, () =>
        rng() < 0.2 ? FREE : Math.floor(rng() * range) - 5,
      );
      const major = Math.floor(rng() * 6);
      const minor = Math.floor(rng() * (6 - major));
      expect(tuningsNeeded(g, major, minor), JSON.stringify({ g, major, minor })).toBe(
        bruteTuningsNeeded(g, major, minor),
      );
    }
  };

  it("matches a brute force over every mod placement", () => check(7, 12));

  it("reports the fewest units short when the targets can't be reached", () => check(17, 16));
});

/** Recompute a recipe's stats from its rolls, mods, tunings, fragments and exotic bonus. */
function recompute(recipe: TheoryRecipe, input: TheoryInput): number[] {
  const raw = input.fragmentBonus.map((v, s) => v + (input.exotic?.intrinsic[s] ?? 0));
  for (const piece of recipe.pieces) {
    const u = rollUnits(piece);
    for (let s = 0; s < 6; s++) raw[s] += 5 * u[s];
    if (piece.tuning) {
      raw[piece.tuning.plus] += 5;
      raw[piece.tuning.minus] -= 5;
    }
  }
  recipe.mods.forEach(([major, minor], s) => (raw[s] += 10 * major + 5 * minor));
  return raw.map((v) => Math.max(0, Math.min(200, v)));
}

function expectSound(recipe: TheoryRecipe, input: TheoryInput) {
  expect(recipe.pieces.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4]);
  expect(recompute(recipe, input)).toEqual(recipe.stats);
  recipe.stats.forEach((v, s) => expect(v).toBeGreaterThanOrEqual(input.minimums[s]));
  const majors = recipe.mods.reduce((n, [m]) => n + m, 0);
  const minors = recipe.mods.reduce((n, [, m]) => n + m, 0);
  expect(majors).toBeLessThanOrEqual(input.mods.major);
  expect(minors).toBeLessThanOrEqual(input.mods.minor);
  expect(recipe.tuned).toBe(recipe.pieces.filter((p) => p.tuning && !p.exotic).length);

  const exotics = recipe.pieces.filter((p) => p.exotic);
  expect(exotics).toHaveLength(input.exotic ? 1 : 0);
  if (input.exotic?.rolls) {
    const e = exotics[0];
    expect(input.exotic.rolls).toContainEqual({ archetype: e.archetype, tertiary: e.tertiary });
  }
  for (const req of input.sets) {
    const n = recipe.pieces.filter((p) => p.setHash === req.setHash).length;
    expect(n).toBeGreaterThanOrEqual(req.count);
  }
  for (const p of exotics) {
    expect(p.setHash).toBeUndefined();
    expect(p.slot).toBe(input.exotic!.slot);
  }

  const slots = new Set<number>();
  for (const piece of recipe.pieces) {
    if (piece.tuning) expect(piece.tuning.plus).not.toBe(piece.tuning.minus);
    if (!piece.owned) continue;
    expect(slots.has(piece.slot)).toBe(false);
    slots.add(piece.slot);
    if (piece.exotic) {
      const o = input.exotic!.owned.find((x) => x.instanceId === piece.owned!.instanceId)!;
      expect(piece.slot).toBe(input.exotic!.slot);
      expect([o.archetype, o.tertiary]).toEqual([piece.archetype, piece.tertiary]);
      continue;
    }
    expect(piece.slot).not.toBe(input.exotic?.slot);
    const o = input.owned.find((x) => x.instanceId === piece.owned!.instanceId)!;
    expect(o.slot).toBe(piece.slot);
    expect(o.archetype).toBe(piece.archetype);
    expect(o.tertiary).toBe(piece.tertiary);
    if (piece.tuning) expect(piece.tuning.plus).toBe(o.tuned);
    if (piece.setHash !== undefined) expect(o.setHash).toBe(piece.setHash);
  }
  expect(recipe.owned).toBe(slots.size);
  expect(recipe.openSlots).toEqual([0, 1, 2, 3, 4].filter((s) => !slots.has(s)));
}

function input(partial: Partial<TheoryInput>): TheoryInput {
  return {
    archetypes: ARCHETYPES,
    owned: [],
    minimums: [0, 0, 0, 0, 0, 0],
    mods: { major: 0, minor: 5 },
    fragmentBonus: [0, 0, 0, 0, 0, 0],
    exotic: null,
    sets: [],
    ...partial,
  };
}

/** The space a query runs on (cached per owned pieces + exotic, like the worker). */
const spaces = new Map<string, TheorySpace>();
function solve(q: TheoryInput) {
  const key = JSON.stringify([q.archetypes, q.owned, q.exotic && { ...q.exotic, intrinsic: 0 }]);
  let space = spaces.get(key);
  if (!space) {
    space = buildTheorySpace(q.archetypes, q.owned, q.exotic);
    spaces.set(key, space);
  }
  return solveTheory(q, space);
}

describe("solveTheory", () => {
  it("lists only builds that really reach the targets", () => {
    const rng = mulberry32(11);
    for (let trial = 0; trial < 8; trial++) {
      const major = Math.floor(rng() * 6);
      const q = input({
        minimums: Array.from({ length: 6 }, () => (rng() < 0.4 ? 0 : Math.floor(rng() * 110))),
        mods: { major, minor: 5 - major },
        fragmentBonus: Array.from({ length: 6 }, () => [0, 0, 10, -10, 20][Math.floor(rng() * 5)]),
      });
      const result = solve(q);
      for (const r of result.recipes) {
        expectSound(r, q);
        r.stats.forEach((v, s) => expect(v).toBeLessThanOrEqual(result.ceilings[s]));
      }
    }
  }, 30_000);

  it("maxes each stat in its own builds, up to the ceiling", () => {
    const q = input({ minimums: [100, 60, 30, 0, 0, 0], mods: { major: 3, minor: 2 } });
    const result = solve(q);
    expect(result.recipes.length).toBeGreaterThan(0);
    for (let s = 0; s < 6; s++) {
      const best = Math.max(...result.recipes.map((r) => r.stats[s]));
      expect(best).toBe(result.ceilings[s]);
    }
    expect(result.recipes.some((r) => r.focus === "flexible")).toBe(true);
  });

  it("each stat's best card reaches the stat's max, even with every target set", () => {
    // A stat-focused build mustn't give its own stat away as a tuning donor.
    const rng = mulberry32(23);
    for (let trial = 0; trial < 10; trial++) {
      const major = Math.floor(rng() * 3);
      const q = input({
        // High enough that mods alone don't cover them, so tunings (and donors) are needed.
        minimums: Array.from({ length: 6 }, () => 50 + Math.floor(rng() * 40)),
        mods: { major, minor: 5 - major },
      });
      const result = solve(q);
      for (let f = 0; f < 6; f++) {
        const focused = result.recipes.filter((r) => r.focus === f);
        if (!focused.length) continue;
        expect(Math.max(...focused.map((r) => r.stats[f])), JSON.stringify({ q: q.minimums, f })).toBe(
          result.ceilings[f],
        );
      }
    }
  }, 30_000);

  it("tunes the stats owned pieces can carry, so a fully owned build is found", () => {
    // Five owned Brawler / Weapons-tertiary pieces, tuned to Weapons, from a 4pc set. With
    // five majors they reach every target if the majors go on Health, Class, Grenade,
    // Super and Melee and one piece takes +5 Weapons. Greedy mods instead put the last
    // major on Weapons and need a Health tuning none of them carries.
    const owned: OwnedRoll[] = [0, 1, 2, 3, 4].map((slot) => ({
      instanceId: `b${slot}`,
      slot,
      archetype: "Brawler",
      tertiary: 0,
      tuned: 0,
      setHash: 7,
    }));
    const q = input({
      owned,
      sets: [{ setHash: 7, count: 4 }],
      minimums: [105, 130, 35, 35, 35, 160],
      mods: { major: 5, minor: 0 },
    });
    const result = solve(q);
    for (const r of result.recipes) expectSound(r, q);
    expect(result.recipes[0].owned).toBe(5);
  });

  it("ranks on the owned pieces a build really seats, not the scan's bound", () => {
    // Owned Gunners outside the required set: the scan counts them, but a 4pc set with an
    // exotic leaves no legendary free for them, so they can't be seated.
    const owned: OwnedRoll[] = [0, 1, 3, 4].map((slot) => ({
      instanceId: `g${slot}`,
      slot,
      archetype: "Gunner",
      tertiary: 1,
      tuned: 0,
    }));
    const exotic = { slot: 2, rolls: null, intrinsic: [0, 0, 0, 0, 0, 0], owned: [] };
    const q = input({
      owned,
      exotic,
      sets: [{ setHash: 9, count: 4 }],
      minimums: [120, 60, 0, 0, 0, 0],
      mods: { major: 3, minor: 2 },
    });
    const result = solve(q);
    for (const r of result.recipes) {
      expectSound(r, q);
      expect(r.owned).toBe(0);
    }
    for (let f = 0; f < 6; f++) {
      const focused = result.recipes.filter((r) => r.focus === f);
      if (focused.length) expect(Math.max(...focused.map((r) => r.stats[f]))).toBe(result.ceilings[f]);
    }
  });

  it("returns nothing for targets no five rolls can reach", () => {
    const result = solve(input({ minimums: [200, 200, 200, 0, 0, 0] }));
    expect(result.recipes).toEqual([]);
  });

  it("needs no tuning when the rolls alone reach the targets", () => {
    // Any five rolls give at least 25 in every stat.
    const result = solve(input({ minimums: [25, 25, 25, 25, 25, 25] }));
    const flexible = result.recipes.filter((r) => r.focus === "flexible");
    expect(flexible.length).toBeGreaterThan(0);
    expect(flexible[0].tuned).toBe(0);
  });

  it("seats owned pieces with the exact roll, slots distinct, tuned stat matching", () => {
    // Weapons-heavy targets; the player owns Gunner pieces (weapons/grenade) with a
    // health tertiary in three slots, tuned to weapons — and a fourth tuned to class.
    const owned: OwnedRoll[] = [
      { instanceId: "h", slot: 0, archetype: "Gunner", tertiary: 1, tuned: 0 },
      { instanceId: "a", slot: 1, archetype: "Gunner", tertiary: 1, tuned: 0 },
      { instanceId: "c", slot: 2, archetype: "Gunner", tertiary: 1, tuned: 0 },
      { instanceId: "c2", slot: 2, archetype: "Gunner", tertiary: 1, tuned: 2 },
    ];
    const q = input({ owned, minimums: [150, 60, 0, 0, 0, 0], mods: { major: 2, minor: 3 } });
    const space = buildTheorySpace(ARCHETYPES, owned);
    const result = solveTheory(q, space);
    expect(result.recipes.length).toBeGreaterThan(0);
    for (const r of result.recipes) expectSound(r, q);
    expect(result.recipes[0].owned).toBe(3);
  });

  it("finds the exact per-stat maxima (brute force over a smaller archetype list)", () => {
    const archetypes = ARCHETYPES.filter((a) =>
      ["Gunner", "Bulwark", "Paragon"].includes(a.name),
    );
    const rollList = theoryRolls(archetypes);
    const rolls = rollList.map(rollUnits);
    const rng = mulberry32(3);
    for (let trial = 0; trial < 6; trial++) {
      const major = Math.floor(rng() * 4);
      const minor = Math.floor(rng() * (4 - major));
      // Odd trials wear an exotic held to two rolls, with a stat bonus.
      const exoticRolls = [rollList[1], rollList[6]];
      const q = input({
        archetypes,
        minimums: Array.from({ length: 6 }, () => (rng() < 0.5 ? 0 : Math.floor(rng() * 80))),
        mods: { major, minor },
        fragmentBonus: Array.from({ length: 6 }, () => [0, 10, -10][Math.floor(rng() * 3)]),
        exotic:
          trial % 2
            ? {
                slot: 1,
                rolls: exoticRolls.map((r) => ({ archetype: r.archetype, tertiary: r.tertiary })),
                intrinsic: [0, 10, 0, 0, 0, 5],
                owned: [],
              }
            : null,
      });
      const constant = q.fragmentBonus.map((v, s) => v + (q.exotic?.intrinsic[s] ?? 0));
      const want = new Array(6).fill(0);
      // Every multiset of the rolls; for each stat, scan its gain upward.
      const walk = (from: number, left: number, sum: number[]) => {
        if (left === 0) {
          for (let f = 0; f < 6; f++) {
            const g = q.minimums.map((m, s) =>
              m > 0 ? Math.ceil((m - constant[s]) / 5) - sum[s] : FREE,
            );
            g[f] = FREE;
            if (bruteTuningsNeeded(g, major, minor) < 0) continue;
            const x = constant[f] + 5 * sum[f];
            for (let u = -60; u <= 40; u++) {
              g[f] = u;
              if (bruteTuningsNeeded(g, major, minor) < 0) break;
              want[f] = Math.max(want[f], Math.max(0, Math.min(200, x + 5 * u)));
            }
          }
          return;
        }
        for (let r = from; r < rolls.length; r++) {
          walk(r, left - 1, sum.map((v, s) => v + rolls[r][s]));
        }
      };
      if (q.exotic) {
        for (const e of exoticRolls) walk(0, 4, rollUnits(e));
      } else {
        walk(0, 5, [0, 0, 0, 0, 0, 0]);
      }
      expect(solve(q).ceilings).toEqual(want);
    }
  }, 60_000);

  it("wears the exotic in its slot, with its stat bonus", () => {
    const exotic = {
      slot: 0,
      rolls: null,
      intrinsic: [0, 0, 0, 0, 0, 10],
      owned: [{ instanceId: "x", archetype: "Brawler", tertiary: 0 }],
    };
    // A legendary in the exotic's slot can't be used; the owned exotic copy can.
    const owned: OwnedRoll[] = [
      { instanceId: "h", slot: 0, archetype: "Brawler", tertiary: 0, tuned: 5 },
      { instanceId: "a", slot: 1, archetype: "Brawler", tertiary: 0, tuned: 5 },
    ];
    const q = input({ owned, exotic, minimums: [80, 80, 0, 0, 0, 140], mods: { major: 2, minor: 3 } });
    const result = solve(q);
    expect(result.recipes.length).toBeGreaterThan(0);
    for (const r of result.recipes) {
      expectSound(r, q);
      expect(r.pieces[0].exotic).toBe(true); // the exotic is a helmet (slot 0)
      expect(r.pieces.some((p) => p.owned?.instanceId === "h")).toBe(false);
    }
    expect(result.recipes[0].owned).toBe(2);
    expect(result.recipes[0].pieces[0].owned?.instanceId).toBe("x");
  });

  it("holds an exotic class item to the rolls its Spirits allow", () => {
    const exotic = {
      slot: 4,
      rolls: [
        { archetype: "Paragon", tertiary: 3 },
        { archetype: "Paragon", tertiary: 0 },
      ],
      intrinsic: [0, 0, 0, 0, 0, 0],
      owned: [],
    };
    const q = input({ exotic, minimums: [100, 0, 0, 0, 100, 0], mods: { major: 3, minor: 2 } });
    const result = solve(q);
    expect(result.recipes.length).toBeGreaterThan(0);
    for (const r of result.recipes) expectSound(r, q);
  });

  it("gives set bonuses their pieces, and counts only owned pieces from the set", () => {
    const exotic = { slot: 2, rolls: null, intrinsic: [0, 0, 0, 0, 0, 0], owned: [] };
    const owned: OwnedRoll[] = [
      { instanceId: "inA", slot: 0, archetype: "Gunner", tertiary: 1, tuned: 0, setHash: 1 },
      { instanceId: "inB", slot: 1, archetype: "Gunner", tertiary: 1, tuned: 0, setHash: 2 },
      { instanceId: "none", slot: 3, archetype: "Gunner", tertiary: 1, tuned: 0 },
    ];
    const base = { owned, exotic, minimums: [120, 60, 0, 0, 0, 0], mods: { major: 3, minor: 2 } };

    const two = input({ ...base, sets: [{ setHash: 1, count: 2 }, { setHash: 2, count: 2 }] });
    const r2 = solve(two);
    expect(r2.setsDontFit).toBe(false);
    for (const r of r2.recipes) expectSound(r, two);
    // Both set pieces are owned; the unset one can't be, since all four legendaries are
    // spoken for by the sets.
    expect(r2.recipes[0].owned).toBe(2);

    const four = input({ ...base, sets: [{ setHash: 1, count: 4 }] });
    const r4 = solve(four);
    for (const r of r4.recipes) expectSound(r, four);
    expect(r4.recipes[0].owned).toBe(1);
    expect(r4.recipes[0].pieces.find((p) => p.owned)?.owned?.instanceId).toBe("inA");

    const tooMany = input({ ...base, sets: [{ setHash: 1, count: 4 }, { setHash: 2, count: 2 }] });
    const rx = solve(tooMany);
    expect(rx.setsDontFit).toBe(true);
    expect(rx.recipes).toEqual([]);
  });

  it("fills out a short list with other archetype mixes for the same stats", () => {
    // Tight targets leave few sums; some of their builds share stats with another mix.
    const q = input({ minimums: [200, 0, 50, 70, 70, 90], mods: { major: 3, minor: 2 } });
    const result = solve(q);
    for (const r of result.recipes) expectSound(r, q);
    const byStats = new Map<string, number>();
    for (const r of result.recipes) byStats.set(r.stats.join(), (byStats.get(r.stats.join()) ?? 0) + 1);
    expect([...byStats.values()].some((n) => n > 1)).toBe(true);
  });

  it("shows close builds beside a lone exact one", () => {
    // Every stat at its max: only one mix of rolls makes it.
    const q = input({ minimums: [200, 0, 50, 70, 70, 100], mods: { major: 3, minor: 2 } });
    const result = solve(q);
    expect(result.recipes).toHaveLength(1);
    expect(result.close.length).toBeGreaterThan(0);
  });

  it("lists close builds when nothing quite makes it", () => {
    const q = input({ minimums: [200, 0, 50, 70, 70, 110], mods: { major: 3, minor: 2 } });
    const result = solve(q);
    expect(result.recipes).toEqual([]);
    expect(result.close.length).toBeGreaterThan(0);
    for (const r of result.close) {
      expect(r.focus).toBe("close");
      expect(recompute(r, q)).toEqual(r.stats);
      expect(r.short).toEqual(q.minimums.map((m, s) => Math.max(0, m - r.stats[s])));
      const missed = r.short!.reduce((a, b) => a + b, 0);
      expect(missed).toBeGreaterThan(0);
      expect(missed).toBeLessThanOrEqual(20);
    }
    // Fewest points missed first.
    const missed = result.close.map((r) => r.short!.reduce((a, b) => a + b, 0));
    expect(missed[0]).toBe(Math.min(...missed));
  });

  it("solves a query on the full space quickly", () => {
    const q = input({ minimums: [120, 80, 40, 0, 50, 0], mods: { major: 3, minor: 2 } });
    const t0 = performance.now();
    solve(q);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
