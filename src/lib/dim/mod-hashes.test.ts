import { expect, test } from "vitest";
import { statModLabel } from "./mod-hashes";
import { ARTIFICE_MOD_CATEGORY, GENERAL_MOD_CATEGORY, STAT_HASHES } from "../armory/stats";

const ENERGY = 3578062600;

const plug = (cat: string, ...stats: [number, number][]) => ({
  plug: { plugCategoryIdentifier: cat },
  investmentStats: [{ statTypeHash: ENERGY, value: 3 }, ...stats.map(([statTypeHash, value]) => ({ statTypeHash, value }))],
});

test("statModLabel reads a stat mod as its stat gain", () => {
  expect(statModLabel(plug(GENERAL_MOD_CATEGORY, [STAT_HASHES.grenade, 10]))).toBe("+10 Grenade");
  expect(statModLabel(plug(GENERAL_MOD_CATEGORY, [STAT_HASHES.weapons, 5]))).toBe("+5 Weapons");
  expect(statModLabel(plug(ARTIFICE_MOD_CATEGORY, [STAT_HASHES.super, 3]))).toBe("+3 Super");
  expect(statModLabel(plug("enhancements.v2_head", [STAT_HASHES.grenade, 10]))).toBeUndefined();
  expect(statModLabel(undefined)).toBeUndefined();
});

test("statModLabel reads directional tuning as +N / −N, and leaves Balanced Tuning alone", () => {
  const tuning = "v460.plugs.armor.tuning.mods";
  expect(statModLabel(plug(tuning, [STAT_HASHES.grenade, -5], [STAT_HASHES.weapons, 5]))).toBe(
    "+5 Weapons / −5 Grenade",
  );
  expect(
    statModLabel(plug(tuning, [STAT_HASHES.grenade, 1], [STAT_HASHES.weapons, 1], [STAT_HASHES.super, 1])),
  ).toBeUndefined();
});
