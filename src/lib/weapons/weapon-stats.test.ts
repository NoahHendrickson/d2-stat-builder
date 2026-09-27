import { describe, expect, it } from "vitest";

import { sampleWeapons } from "./fixtures/sample-weapons";
import {
  computeWeaponStats,
  interpolateStatValue,
  sampleStatGroup,
  sumInvestmentStats,
} from "./weapon-stats";

describe("interpolateStatValue", () => {
  it("linearly maps investment to display value", () => {
    const display = sampleStatGroup.scaledStats[0]!;
    expect(interpolateStatValue(50, display)).toBe(50);
    expect(interpolateStatValue(0, display)).toBe(0);
    expect(interpolateStatValue(100, display)).toBe(100);
  });
});

describe("sumInvestmentStats", () => {
  it("merges base stats with plug mods", () => {
    const merged = sumInvestmentStats(
      [{ hash: 2, name: "Range", value: 46 }],
      [{ hash: 2, value: 10 }, { hash: 4, value: 20 }],
    );
    expect(merged.get(2)?.value).toBe(56);
    expect(merged.get(4)?.value).toBe(20);
  });
});

describe("computeWeaponStats", () => {
  const fatebringer = sampleWeapons[0]!;
  const statGroups = { [String(sampleStatGroup.hash)]: sampleStatGroup };

  it("returns base stats when no perks are selected", () => {
    const { stats, baseStats } = computeWeaponStats(fatebringer, [], statGroups);
    expect(stats).toEqual(baseStats);
    expect(stats.find((s) => s.name === "Range")?.value).toBe(46);
  });

  it("applies barrel and magazine stat mods", () => {
    const { stats, baseStats } = computeWeaponStats(
      fatebringer,
      [101, 103],
      statGroups,
    );
    expect(baseStats.find((s) => s.name === "Range")?.value).toBe(46);
    // Fluted: -5 range, Accurized: +10 range → net +5
    expect(stats.find((s) => s.name === "Range")?.value).toBe(51);
    // Fluted: +20 handling
    expect(stats.find((s) => s.name === "Handling")?.value).toBe(50);
  });

  it("falls back to weapon.stats without investment data", () => {
    const weapon = { ...fatebringer, investmentStats: undefined, statGroupHash: undefined };
    const { stats, baseStats } = computeWeaponStats(weapon, [101], statGroups);
    expect(stats).toEqual(weapon.stats);
    expect(baseStats).toEqual(weapon.stats);
  });

  it("applies masterwork stat mods", () => {
    const { stats, baseStats } = computeWeaponStats(
      fatebringer,
      [],
      statGroups,
      [{ hash: 3, value: 10 }],
    );
    expect(baseStats.find((s) => s.name === "Stability")?.value).toBe(50);
    expect(stats.find((s) => s.name === "Stability")?.value).toBe(60);
  });

  it("stacks masterwork mods with selected perk mods", () => {
    const { stats } = computeWeaponStats(
      fatebringer,
      [101, 103],
      statGroups,
      [{ hash: 2, value: 10 }],
    );
    // Fluted: -5 range, Accurized: +10 range, masterwork range: +10 → net +15 from base 46
    expect(stats.find((s) => s.name === "Range")?.value).toBe(61);
  });
});
