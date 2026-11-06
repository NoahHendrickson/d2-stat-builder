import { test, expect } from "vitest";
import { ARTIFICE_MOD_CATEGORY, GENERAL_MOD_CATEGORY } from "../armory/stats";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import type { Manifest } from "../manifest/load";
import { mergeBuildIntoLoadout, updateLookups } from "./update-from-build";

const GUNSLINGER = 2240888816;
const NIGHTSTALKER = 2453351420;
const HELMET_BUCKET = 3448274439;
const KINETIC_BUCKET = 1498876634;

// 1xx armor, 2xx weapons, 3xx general stat mods, 4xx artifice, 5xx tuning, 6xx other mods.
const defs: Record<number, object> = {
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
const manifest = { def: (_table: string, hash: number) => defs[hash] } as unknown as Manifest;
// Fragments live in sockets 7–8 here; the real lookup reads the subclass's socket group.
const withFragments = (item: DimLoadoutItem, hashes: number[]): DimLoadoutItem => ({
  ...item,
  socketOverrides: { ...item.socketOverrides, 7: hashes[0] ?? 0, 8: hashes[1] ?? 0 },
});
const lookups = { ...updateLookups(manifest, 1, (id) => id === "owned-helmet"), withFragments };

const existing: DimLoadout = {
  id: "dim-uuid",
  name: "Old name",
  notes: "#raid",
  classType: 1,
  equipped: [
    { id: "old-helmet", hash: 101 },
    { id: "owned-helmet", hash: 999 },
    { id: "12345", hash: GUNSLINGER, socketOverrides: { 0: 7, 7: 70, 8: 80 } },
    { id: "gun", hash: 201 },
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
  classType: 1,
  equipped: [
    { id: "new-helmet", hash: 102 },
    { id: "12345", hash: GUNSLINGER, socketOverrides: { 7: 90 } },
  ],
  unequipped: [],
  parameters: {
    mods: [302, 302, 401],
    assumeArmorMasterwork: 3,
    exoticArmorHash: 102,
    artifactUnlocks: { unlockedItemHashes: [3], seasonNumber: 27 },
  },
};

const gunslinger = { itemHash: GUNSLINGER, fragmentHashes: [90] };

test("swaps the armor and keeps the saved weapons and spares", () => {
  const merged = mergeBuildIntoLoadout(existing, build, gunslinger, lookups);
  expect(merged.equipped.slice(0, 2)).toEqual([
    { id: "new-helmet", hash: 102 },
    { id: "gun", hash: 201 },
  ]);
  expect(merged.unequipped).toEqual(existing.unequipped);
  expect(merged.id).toBe("dim-uuid");
  expect(merged.name).toBe("New name");
});

test("the saved subclass keeps its Super and aspects but takes the builder's fragments", () => {
  const merged = mergeBuildIntoLoadout(existing, build, gunslinger, lookups);
  expect(merged.equipped[2]).toEqual({
    id: "12345",
    hash: GUNSLINGER,
    socketOverrides: { 0: 7, 7: 90, 8: 0 },
  });
});

test("a builder on another subclass replaces the saved one", () => {
  const nightstalker = { ...build, equipped: [build.equipped[0], { id: "12345", hash: NIGHTSTALKER, socketOverrides: { 7: 91 } }] };
  const merged = mergeBuildIntoLoadout(existing, nightstalker, { itemHash: NIGHTSTALKER, fragmentHashes: [91] }, lookups);
  expect(merged.equipped[2]).toEqual({ id: "12345", hash: NIGHTSTALKER, socketOverrides: { 7: 91 } });
  // No fragments picked: no carrier on the build, so just the subclass item.
  const bare = mergeBuildIntoLoadout(existing, { ...build, equipped: [build.equipped[0]] }, { itemHash: NIGHTSTALKER, fragmentHashes: [] }, lookups);
  expect(bare.equipped[2]).toEqual({ hash: NIGHTSTALKER });
});

test("the build's stat, tuning and artifice mods replace the saved ones; others stay", () => {
  const merged = mergeBuildIntoLoadout(existing, build, gunslinger, lookups);
  expect(merged.parameters.mods).toEqual([302, 302, 401, 601, 602, 601]);
});

test("the build's targets replace the saved ones, but the saved artifact perks stay", () => {
  const { parameters } = mergeBuildIntoLoadout(existing, build, gunslinger, lookups);
  expect(parameters.statConstraints).toBeUndefined();
  expect(parameters.exoticArmorHash).toBe(102);
  expect(parameters.artifactUnlocks).toEqual(existing.parameters.artifactUnlocks);
});

test("a saved loadout without a subclass takes the build's", () => {
  const merged = mergeBuildIntoLoadout(
    { ...existing, equipped: [{ id: "old-helmet", hash: 101 }], parameters: { mods: [], assumeArmorMasterwork: 3 } },
    build,
    gunslinger,
    lookups,
  );
  expect(merged.equipped).toEqual(build.equipped);
  expect(merged.parameters.artifactUnlocks).toEqual(build.parameters.artifactUnlocks);
});
