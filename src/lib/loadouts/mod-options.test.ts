import { test, expect } from "vitest";
import { dedupeModOptions, isExcludedModName, statModName, type ModOption } from "./mod-options";
import { ARTIFICE_MOD_CATEGORY, GENERAL_MOD_CATEGORY, STAT_HASHES } from "@/lib/armory/stats";

const opt = (hash: number, name: string, cost: number, artifactOnly = false): ModOption => ({
  hash,
  name,
  cost,
  stackable: true,
  artifactOnly,
});

const siphon3 = opt(1, "Arc Siphon", 3);
const siphon1 = opt(2, "Arc Siphon", 1, true);
const dynamo = opt(3, "Dynamo", 1);

test("dedupeModOptions shows the full-cost copy when insertability is unknown", () => {
  expect(dedupeModOptions([siphon1, siphon3, dynamo]).map((o) => o.hash)).toEqual([3, 1]);
});

test("dedupeModOptions prefers the copy the player can insert", () => {
  expect(dedupeModOptions([siphon3, siphon1, dynamo], new Set([2, 3])).map((o) => o.hash)).toEqual([
    2, 3,
  ]);
  // Neither copy insertable → fall back to the full-cost one rather than hiding the mod.
  expect(dedupeModOptions([siphon3, siphon1], new Set([3])).map((o) => o.hash)).toEqual([1]);
});

test("dedupeModOptions drops exact hash repeats", () => {
  expect(dedupeModOptions([dynamo, dynamo])).toHaveLength(1);
});

test("isExcludedModName hides Curse of Riven leftovers", () => {
  expect(isExcludedModName("Curse of Riven")).toBe(true);
  expect(isExcludedModName("Riven's Curse")).toBe(true);
  expect(isExcludedModName("Arc Siphon")).toBe(false);
});

test("statModName reads a stat mod as its stat gain", () => {
  const mod = (cat: string, value: number, statTypeHash = STAT_HASHES.grenade) => ({
    plug: { plugCategoryIdentifier: cat },
    investmentStats: [{ statTypeHash: 3578062600, value: 3 }, { statTypeHash, value }],
  });
  expect(statModName(mod(GENERAL_MOD_CATEGORY, 10))).toBe("+10 Grenade");
  expect(statModName(mod(GENERAL_MOD_CATEGORY, 5, STAT_HASHES.weapons))).toBe("+5 Weapons");
  expect(statModName(mod(ARTIFICE_MOD_CATEGORY, 3, STAT_HASHES.super))).toBe("+3 Super");
  expect(statModName(mod("enhancements.v2_head", 10))).toBeUndefined();
  const tuning = (...stats: [number, number][]) => ({
    plug: { plugCategoryIdentifier: "v460.plugs.armor.tuning.mods" },
    investmentStats: stats.map(([statTypeHash, value]) => ({ statTypeHash, value })),
  });
  expect(statModName(tuning([STAT_HASHES.grenade, -5], [STAT_HASHES.weapons, 5]))).toBe(
    "+5 Weapons / −5 Grenade",
  );
  // Balanced Tuning is all-positive: it keeps its own name.
  expect(
    statModName(tuning([STAT_HASHES.grenade, 1], [STAT_HASHES.weapons, 1], [STAT_HASHES.super, 1])),
  ).toBeUndefined();
  expect(statModName(undefined)).toBeUndefined();
});
