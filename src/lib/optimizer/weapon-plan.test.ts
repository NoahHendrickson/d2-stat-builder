import { expect, test } from "vitest";
import {
  assignWeaponMix,
  isCurrentMix,
  planWeapons,
  rankWeaponMixes,
  weaponMixes,
} from "./weapon-plan";
import type { OptimizerInput, OptimizerPiece } from "./types";

/** A tuning-free piece with `total` points in one stat at `power`. */
const piece = (id: string, total: number, power: number): OptimizerPiece => ({
  id,
  stats: [total, 0, 0, 0, 0, 0],
  exotic: false,
  power,
});

/** Every slot offers a strong 550 piece (30) and a weak 200 piece (10). */
function input(min: number, max: number): OptimizerInput {
  return {
    slots: Array.from({ length: 5 }, (_, s) => [
      piece(`hi${s}`, 30, 550),
      piece(`lo${s}`, 10, 200),
    ]),
    minimums: [0, 0, 0, 0, 0, 0],
    mods: { major: 0, minor: 0 },
    allowTuning: false,
    powerRange: { min, max, weapons: [999] },
  };
}

test("weaponMixes lists every multiset of three powers, ascending", () => {
  const mixes = weaponMixes([550, 10, 300]);
  expect(mixes).toHaveLength(10);
  expect(mixes[0]).toEqual([10, 10, 10]);
  expect(mixes).toContainEqual([10, 300, 550]);
  expect(mixes.at(-1)).toEqual([550, 550, 550]);
  expect(weaponMixes([10, 10])).toEqual([[10, 10, 10]]);
});

test("planWeapons keeps the mixes that land a build, each with its best total", () => {
  // Armor sum = 1000 + 350k for k strong pieces; gear power over 8 must sit in 330–350,
  // so the sum with weapons lies in 2640–2807. Lower weapons let more strong pieces in.
  const results = planWeapons(input(330, 350))!;
  const byMix = Object.fromEntries(results.map((r) => [r.weapons.join("/"), r.best]));
  expect(byMix).toEqual({
    "10/10/10": 150, // k = 5
    "10/10/300": 130, // k = 4
    "10/300/300": 110, // k = 3
    "300/550/550": 70, // k = 1
    "550/550/550": 50, // k = 0
  });
  expect(rankWeaponMixes(results, [null, null, null])[0].weapons).toEqual([10, 10, 10]);
});

test("planWeapons is null without a power range", () => {
  expect(planWeapons({ ...input(0, 0), powerRange: undefined })).toBeNull();
});

test("rankWeaponMixes breaks ties toward the entered weapons, then lower power", () => {
  const r = (weapons: number[], best: number) => ({ weapons, best, capped: false });
  const results = [r([300, 300, 550], 100), r([10, 300, 550], 100), r([10, 10, 300], 90)];
  expect(rankWeaponMixes(results, [null, null, null]).map((m) => m.weapons)).toEqual([
    [10, 300, 550],
    [300, 300, 550],
    [10, 10, 300],
  ]);
  expect(rankWeaponMixes(results, [300, 300, null]).map((m) => m.weapons)).toEqual([
    [300, 300, 550],
    [10, 300, 550],
    [10, 10, 300],
  ]);
});

test("assignWeaponMix keeps entered weapons that are part of the mix in their slots", () => {
  expect(assignWeaponMix([null, null, null], [10, 300, 550])).toEqual([10, 300, 550]);
  expect(assignWeaponMix([550, null, 300], [10, 300, 550])).toEqual([550, 10, 300]);
  expect(assignWeaponMix([420, 300, 300], [10, 300, 550])).toEqual([10, 300, 550]);
});

test("isCurrentMix matches the entered weapons in any order, all slots filled", () => {
  expect(isCurrentMix([550, 10, 300], [10, 300, 550])).toBe(true);
  expect(isCurrentMix([10, 300, null], [10, 300, 550])).toBe(false);
  expect(isCurrentMix([10, 10, 300], [10, 300, 300])).toBe(false);
});
