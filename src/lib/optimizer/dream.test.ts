import { describe, expect, it } from "vitest";
import {
  dreamCandidates,
  dreamRolls,
  farmOdds,
  solveDream,
  type DreamArchetype,
  type DreamInput,
} from "./dream";
import { solve } from "./solve";
import { realWarlockSlots } from "./real-pool.fixture";
import type { OptimizerInput, OptimizerPiece } from "./types";

// The 12 Armor 3.0 archetypes as of 2026-09-24 (live manifest), in STAT_ORDER
// indices: weapons 0, health 1, class 2, grenade 3, super 4, melee 5.
const ARCHETYPES: DreamArchetype[] = [
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

/** A masterworked T5 legendary with the given primary/secondary/tertiary. */
function t5(id: string, p: number, s: number, t: number, tuned = p): OptimizerPiece {
  const stats = [5, 5, 5, 5, 5, 5];
  stats[p] = 30;
  stats[s] = 25;
  stats[t] = 20;
  const offStats = [0, 1, 2, 3, 4, 5].filter((i) => i !== p && i !== s && i !== t);
  return { id, stats, exotic: false, tuning: { tuned, offStats } };
}

function input(slots: OptimizerPiece[][], minimums: number[]): OptimizerInput {
  return {
    slots,
    minimums,
    mods: { major: 0, minor: 0 },
    exotic: { mode: "any" },
    allowTuning: true,
    allowBalancedTuning: false,
    maxResults: 50,
  };
}

const dream = (base: OptimizerInput, extra: Partial<DreamInput> = {}): DreamInput => ({
  base,
  archetypes: ARCHETYPES,
  exotic: { kind: "none" },
  ...extra,
});

describe("dreamRolls", () => {
  it("enumerates every archetype × tertiary with the T5 30/25/20 + MW5 shape", () => {
    const rolls = dreamRolls(ARCHETYPES);
    expect(rolls).toHaveLength(12 * 4);
    for (const r of rolls) {
      expect([...r.stats].sort((a, b) => b - a)).toEqual([30, 25, 20, 5, 5, 5]);
      expect(r.stats[r.archetype.primary]).toBe(30);
      expect(r.stats[r.archetype.secondary]).toBe(25);
      expect(r.stats[r.tertiary]).toBe(20);
    }
  });

  it("offers each roll once per required set instead of set-less", () => {
    const base = input([[], [], [], [], []], [0, 0, 0, 0, 0, 0]);
    base.setRequirements = [
      { setHash: 11, count: 2 },
      { setHash: 22, count: 2 },
    ];
    const pieces = dreamCandidates(0, dream(base));
    // Per roll and set: one untuned (any tuned stat) variant plus one per tuned stat.
    expect(pieces).toHaveLength(48 * 7 * 2);
    expect(new Set(pieces.map((p) => p.setHash))).toEqual(new Set([11, 22]));
  });
});

describe("solveDream", () => {
  // Five Gunners (weapons 30 / grenade 25 / super 20), tuned grenade: weapons 150,
  // grenade 125 (+25 by tuning), melee 25.
  const gunners = () =>
    Array.from({ length: 5 }, (_, i) => [t5(`g${i}`, 0, 3, 4, 3)]);

  it("needs no new pieces when owned armor already reaches the targets", () => {
    const r = solveDream(dream(input(gunners(), [150, 0, 0, 125, 0, 0])));
    expect(r.newPieces).toBe(0);
    expect(r.options).toHaveLength(0);
  });

  it("finds the single roll that lifts a stat past its owned ceiling", () => {
    // Owned: melee 25 max. Melee 45 with weapons 145 means trading one Gunner for a
    // piece with weapons ≥ 25 and melee ≥ 25: a Skirmisher (melee 30 / weapons 25), or
    // a roll one +5 tune short, e.g. a Reaver with a weapons tertiary tuned weapons.
    const base = input(gunners(), [145, 0, 0, 0, 0, 45]);
    expect(solve(base).loadouts).toHaveLength(0);
    const r = solveDream(dream(base));
    expect(r.newPieces).toBe(1);
    const farm = r.options.map((o) => o.farm[0]);
    expect(farm.length).toBeGreaterThan(1);
    for (const f of farm) {
      // Exactly the tertiaries that leave at most one stat short, by at most 5 (one +5
      // tune covers it): any tuned stat when none is short, otherwise just that one.
      const expected = dreamRolls(ARCHETYPES)
        .filter((r) => r.archetype.name === f.archetype)
        .map((r) => ({ ...r, short: [0, 5].filter((s) => r.stats[s] < 25) }))
        .filter((r) => r.short.length === 0 || (r.short.length === 1 && r.stats[r.short[0]] >= 20))
        .map((r) => ({ tertiary: r.tertiary, tuned: r.short.length ? r.short : null }));
      expect([...f.rolls].sort((a, b) => a.tertiary - b.tertiary)).toEqual(expected);
    }
    // Every option swaps exactly one owned piece, and no two chase the same roll.
    for (const o of r.options) {
      expect(o.farm).toHaveLength(1);
      expect(o.loadout.pieceIds.filter((id) => id.startsWith("dream:"))).toHaveLength(1);
    }
    const rolls = r.options.map((o) => `${o.farm[0].slot}:${o.farm[0].archetype}`);
    expect(new Set(rolls).size).toBe(rolls.length);
  });

  it("lists the archetype that needs no tune first among equal totals", () => {
    const r = solveDream(dream(input(gunners(), [145, 0, 0, 0, 0, 45])));
    // Skirmisher (melee 30 / weapons 25) works with any tertiary and any tuned stat.
    const first = r.options[0].farm[0];
    expect(first.archetype).toBe("Skirmisher");
    expect(first.rolls).toHaveLength(4);
    expect(first.rolls.every((roll) => roll.tuned === null)).toBe(true);
    expect(farmOdds(first)).toBe(24);
  });

  it("reports null when not even a full new set reaches the targets", () => {
    const r = solveDream(dream(input(gunners(), [200, 200, 200, 200, 200, 200])), {
      budgetMs: 5000,
    });
    expect(r.newPieces).toBeNull();
    expect(r.options).toHaveLength(0);
  });

  it("never puts a dream piece in a locked slot", () => {
    const r = solveDream(
      dream(input(gunners(), [145, 0, 0, 0, 0, 45]), { lockedSlots: [0, 1, 2, 3] }),
    );
    expect(r.newPieces).toBe(1);
    for (const o of r.options) expect(o.farm.map((f) => f.slot)).toEqual([4]);
  });

  it("re-rolls the selected exotic in its own slot", () => {
    const slots = gunners();
    const exo: OptimizerPiece = { ...t5("exo", 1, 2, 3), exotic: true, hash: 777 };
    slots[2] = [...slots[2], exo];
    const base = input(slots, [0, 0, 0, 0, 0, 40]);
    base.exotic = { mode: "specific", hashes: [777] };
    // Owned exotic: melee 5 (+5 from its flexible tune); four Gunners 5 each → 30 < 40.
    expect(solve(base).loadouts).toHaveLength(0);
    const r = solveDream(
      dream(base, {
        exotic: { kind: "specific", slot: 2, hash: 777, name: "Test Exotic", intrinsic: [0, 0, 0, 0, 0, 0] },
        lockedSlots: [0, 1, 3, 4],
      }),
    );
    expect(r.newPieces).toBe(1);
    const exoticFarm = r.options.flatMap((o) => o.farm).filter((f) => f.exotic);
    expect(exoticFarm.length).toBeGreaterThan(0);
    expect(exoticFarm[0].exoticName).toBe("Test Exotic");
    expect(exoticFarm[0].slot).toBe(2);
    expect(exoticFarm[0].rolls.every((roll) => roll.tuned === null)).toBe(true);
  });

  it("stays inside its budget on a real 496-piece pool", () => {
    const base: OptimizerInput = {
      slots: realWarlockSlots(),
      minimums: [200, 0, 0, 160, 0, 0],
      mods: { major: 3, minor: 2 },
      exotic: { mode: "any" },
      allowTuning: true,
      maxResults: 50,
    };
    const t0 = performance.now();
    const r = solveDream(dream(base, { exotic: { kind: "any" } }));
    const ms = performance.now() - t0;
    expect(r.newPieces).not.toBe(0);
    expect(ms).toBeLessThan(20000);
  }, 30000);
});
