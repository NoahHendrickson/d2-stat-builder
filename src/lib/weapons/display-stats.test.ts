import { describe, expect, it } from "vitest";

import { interpolateStat, weaponDisplayStats } from "./display-stats";
import type { PerkRef, StatCurve } from "./types";

const linear: StatCurve = { max: 100, points: [[0, 0], [100, 100]] };
// Impact on SMGs: 30 investment sits exactly halfway between 22 and 23.
const halfway: StatCurve = { max: 100, points: [[0, 15], [100, 30]] };
const magazine: StatCurve = { max: 100, points: [[0, 20], [50, 30], [100, 40]] };

const perk = (name: string, stats: Record<string, number>): PerkRef => ({
  hash: 1,
  name,
  currentlyCanRoll: true,
  stats,
});

describe("interpolateStat", () => {
  it("rounds halves to even like the game", () => {
    expect(interpolateStat(50, halfway)).toBe(22);
    expect(interpolateStat(30, { max: 100, points: [[0, 15], [100, 30]] })).toBe(20);
    expect(interpolateStat(70, { max: 100, points: [[0, 0], [100, 105]] })).toBe(74);
  });

  it("clamps to the curve's range", () => {
    expect(interpolateStat(-10, magazine)).toBe(20);
    expect(interpolateStat(140, magazine)).toBe(40);
    expect(interpolateStat(75, magazine)).toBe(35);
  });
});

describe("weaponDisplayStats", () => {
  const weapon = {
    statInvestment: { Range: 40, Magazine: 50, "Rounds Per Minute": 140 },
    statGroupHash: 7,
  };
  const curves = { "7": { Range: linear, Magazine: magazine } };

  it("shows base stats with no perks; uncurved stats show their investment", () => {
    expect(weaponDisplayStats(weapon, curves)).toEqual({
      Range: 40,
      Magazine: 30,
      "Rounds Per Minute": 140,
    });
  });

  it("adds every slotted perk's modifiers before interpolating", () => {
    const stats = weaponDisplayStats(weapon, curves, [
      perk("Full Bore", { Range: 15, Stability: -10 }),
      perk("Extended Mag", { Magazine: 50, Range: -5 }),
    ]);
    expect(stats).toEqual({ Range: 50, Magazine: 40, "Rounds Per Minute": 140 });
  });
});
