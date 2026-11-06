import { test, expect } from "vitest";
import { ARTIFICE_MOD_CATEGORY, GENERAL_MOD_CATEGORY } from "../armory/stats";
import type { DimLoadout } from "../dim/loadout-link";
import type { DefLookup } from "./resolve";
import { mergeBuildIntoLoadout, updateLookups } from "./update-from-build";

const STORMCALLER = 3168997075;
const HELMET_BUCKET = 3448274439;
const KINETIC_BUCKET = 1498876634;

// 1xx armor, 2xx weapons, 3xx general stat mods, 4xx artifice, 5xx tuning, 6xx other mods.
const defs: Record<number, ReturnType<DefLookup["def"]>> = {
  101: { inventory: { bucketTypeHash: HELMET_BUCKET } },
  102: { inventory: { bucketTypeHash: HELMET_BUCKET } },
  201: { inventory: { bucketTypeHash: KINETIC_BUCKET } },
  301: { plug: { plugCategoryIdentifier: GENERAL_MOD_CATEGORY } },
  302: { plug: { plugCategoryIdentifier: GENERAL_MOD_CATEGORY } },
  401: { plug: { plugCategoryIdentifier: ARTIFICE_MOD_CATEGORY } },
  501: { plug: { plugCategoryIdentifier: "v400.plugs.armor.tuning.mods" } },
  601: { plug: { plugCategoryIdentifier: "enhancements.v2_head" } },
  602: { plug: { plugCategoryIdentifier: "enhancements.season_outlaw" } },
};
const manifest: DefLookup = { def: (_table, hash) => (hash == null ? undefined : defs[hash]) };
const lookups = updateLookups(manifest, (id) => id === "owned-helmet");

const existing: DimLoadout = {
  id: "dim-uuid",
  name: "Old name",
  notes: "#raid",
  classType: 2,
  equipped: [
    { id: "old-helmet", hash: 101 },
    { id: "owned-helmet", hash: 999 },
    { id: "gun", hash: 201 },
    { id: "12345", hash: STORMCALLER, socketOverrides: { 0: 7, 7: 8 } },
  ],
  unequipped: [{ id: "spare", hash: 201 }],
  parameters: {
    mods: [301, 401, 501, 601, 602, 601],
    assumeArmorMasterwork: 3,
    statConstraints: [{ statHash: 1, minStat: 100 }],
    artifactUnlocks: { unlockedItemHashes: [1, 2], seasonNumber: 27 },
  },
};

const build: DimLoadout = {
  id: "stat-builder",
  name: "New name",
  classType: 2,
  equipped: [
    { id: "new-helmet", hash: 102 },
    { id: "12345", hash: STORMCALLER, socketOverrides: { 7: 9 } },
  ],
  unequipped: [],
  parameters: {
    mods: [302, 302, 401],
    assumeArmorMasterwork: 3,
    exoticArmorHash: 102,
    artifactUnlocks: { unlockedItemHashes: [3], seasonNumber: 27 },
  },
};

test("swaps the armor and keeps the saved subclass, weapons and spares", () => {
  const merged = mergeBuildIntoLoadout(existing, build, lookups);
  expect(merged.equipped).toEqual([
    { id: "new-helmet", hash: 102 },
    { id: "gun", hash: 201 },
    { id: "12345", hash: STORMCALLER, socketOverrides: { 0: 7, 7: 8 } },
  ]);
  expect(merged.unequipped).toEqual(existing.unequipped);
  expect(merged.id).toBe("dim-uuid");
  expect(merged.name).toBe("New name");
});

test("the build's stat, tuning and artifice mods replace the saved ones; others stay", () => {
  const merged = mergeBuildIntoLoadout(existing, build, lookups);
  expect(merged.parameters.mods).toEqual([302, 302, 401, 601, 602, 601]);
});

test("the build's targets replace the saved ones, but the saved artifact perks stay", () => {
  const { parameters } = mergeBuildIntoLoadout(existing, build, lookups);
  expect(parameters.statConstraints).toBeUndefined();
  expect(parameters.exoticArmorHash).toBe(102);
  expect(parameters.artifactUnlocks).toEqual(existing.parameters.artifactUnlocks);
});

test("a saved loadout without a subclass takes the build's fragments", () => {
  const merged = mergeBuildIntoLoadout(
    { ...existing, equipped: [{ id: "old-helmet", hash: 101 }], parameters: { mods: [], assumeArmorMasterwork: 3 } },
    build,
    lookups,
  );
  expect(merged.equipped).toEqual(build.equipped);
  expect(merged.parameters.artifactUnlocks).toEqual(build.parameters.artifactUnlocks);
});
