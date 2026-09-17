import { test, expect } from "vitest";
import {
  FESTIVAL_MASK_CATEGORY_HASH,
  FESTIVAL_MASK_HASHES,
  hashesIncludeHelmet,
  inDefaultOptimizerPool,
  helmetCandidates,
  isFestivalMask,
  ownedFestivalMasks,
} from "./festival-masks";

test("known masquerader hashes are Festival of the Lost masks", () => {
  expect(isFestivalMask(2390807586)).toBe(true);
  expect(isFestivalMask(1)).toBe(false);
  expect(FESTIVAL_MASK_HASHES.size).toBe(9);
});

test("defs tagged Mask are treated as FotL masks even without a known hash", () => {
  expect(
    isFestivalMask(99, { itemCategoryHashes: [FESTIVAL_MASK_CATEGORY_HASH] }),
  ).toBe(true);
  expect(isFestivalMask(99, { itemCategoryHashes: [45] })).toBe(false);
  expect(isFestivalMask(99, null)).toBe(false);
});

test("Festival Mask type name and Masquerader's piece names match without a known hash", () => {
  expect(
    isFestivalMask(99, { itemTypeDisplayName: "Festival Mask" }),
  ).toBe(true);
  expect(
    isFestivalMask(99, { displayProperties: { name: "Masquerader's Hood" } }),
  ).toBe(true);
  expect(
    isFestivalMask(99, { displayProperties: { name: "Masquerader's Helm" } }),
  ).toBe(true);
  expect(
    isFestivalMask(99, { displayProperties: { name: "Masquerader's Cowl" } }),
  ).toBe(true);
  expect(
    isFestivalMask(99, { displayProperties: { name: "Winged Sun Helmet" } }),
  ).toBe(false);
});

test("hashesIncludeHelmet matches an owned helmet, not other slots", () => {
  const pieces = [
    { itemHash: 10, slot: "helmet" as const },
    { itemHash: 20, slot: "arms" as const },
  ];
  expect(hashesIncludeHelmet([10], pieces)).toBe(true);
  expect(hashesIncludeHelmet([20], pieces)).toBe(false);
  expect(hashesIncludeHelmet([99], pieces)).toBe(false);
});

test("T5 Festival of the Lost masks stay out of the default optimizer pool", () => {
  const off = { legacyExotics: false, lowerTierArmor: false, legacyArmor: false };
  const mask = { isFestivalMask: true, tunedStat: 0, isExotic: false };
  const t5Helmet = { isFestivalMask: false, tunedStat: 2, isExotic: false };
  const legacyExotic = { isFestivalMask: false, isExotic: true };
  expect(inDefaultOptimizerPool(mask, { ...off, legacyExotics: true })).toBe(false);
  expect(inDefaultOptimizerPool(mask, off)).toBe(false);
  expect(inDefaultOptimizerPool(t5Helmet, off)).toBe(true);
  expect(inDefaultOptimizerPool(legacyExotic, { ...off, legacyExotics: true })).toBe(true);
  expect(inDefaultOptimizerPool(legacyExotic, off)).toBe(false);
});

test("lower-tier Armor 3.0 legendaries join the pool only with the toggle on", () => {
  const off = { legacyExotics: false, lowerTierArmor: false, legacyArmor: false };
  const on = { ...off, lowerTierArmor: true };
  // Tier 1–4 Armor 3.0: archetype but no tuning socket.
  const tier3 = { isFestivalMask: false, archetype: "Gunner", isExotic: false };
  // Legacy Armor 2.0 legendary: neither.
  const legacy = { isFestivalMask: false, isExotic: false };
  // A lower-tier mask is still a mask.
  const tier3Mask = { isFestivalMask: true, archetype: "Gunner", isExotic: false };
  expect(inDefaultOptimizerPool(tier3, on)).toBe(true);
  expect(inDefaultOptimizerPool(tier3, off)).toBe(false);
  expect(inDefaultOptimizerPool(legacy, on)).toBe(false);
  expect(inDefaultOptimizerPool(tier3Mask, on)).toBe(false);
  // The exotic toggle is what governs a non-tunable exotic, not this one.
  const lowerExotic = { isFestivalMask: false, archetype: "Brawler", isExotic: true };
  expect(inDefaultOptimizerPool(lowerExotic, on)).toBe(false);
  expect(inDefaultOptimizerPool(lowerExotic, { ...off, legacyExotics: true })).toBe(true);
});

test("legacy Armor 2.0 legendaries join the pool only with legacyArmor on", () => {
  const off = { legacyExotics: false, lowerTierArmor: false, legacyArmor: false };
  const on = { ...off, legacyArmor: true };
  // Legacy: no archetype, no tuning socket, not exotic.
  const legacy = { isFestivalMask: false, isExotic: false };
  expect(inDefaultOptimizerPool(legacy, on)).toBe(true);
  expect(inDefaultOptimizerPool(legacy, off)).toBe(false);
  // Neither of the other toggles lets a legacy legendary through...
  expect(inDefaultOptimizerPool(legacy, { ...off, lowerTierArmor: true })).toBe(false);
  expect(inDefaultOptimizerPool(legacy, { ...off, legacyExotics: true })).toBe(false);
  // ...and legacyArmor governs neither lower-tier 3.0 pieces, legacy exotics, nor masks.
  expect(inDefaultOptimizerPool({ ...legacy, archetype: "Gunner" }, on)).toBe(false);
  expect(inDefaultOptimizerPool({ ...legacy, isExotic: true }, on)).toBe(false);
  expect(inDefaultOptimizerPool({ ...legacy, isFestivalMask: true }, on)).toBe(false);
});

test("ownedFestivalMasks: this class's masks plus any-class ones, nothing else", () => {
  const pieces = [
    { id: "warlockMask", isFestivalMask: true, classType: 2 },
    { id: "anyMask", isFestivalMask: true, classType: 3 },
    { id: "titanMask", isFestivalMask: true, classType: 0 },
    { id: "warlockHelm", isFestivalMask: false, classType: 2 },
  ];
  expect(ownedFestivalMasks(pieces, 2).map((p) => p.id)).toEqual(["warlockMask", "anyMask"]);
  expect(ownedFestivalMasks(pieces, 1).map((p) => p.id)).toEqual(["anyMask"]);
});

test("helmetCandidates: power constrained → helmets + masks; else helmets", () => {
  const helmets = ["h1", "h2"];
  const masks = ["m1"];
  expect(helmetCandidates(helmets, masks, true)).toEqual(["h1", "h2", "m1"]);
  // No masks owned: the helmet pool is untouched.
  expect(helmetCandidates(helmets, [], true)).toBe(helmets);
  expect(helmetCandidates(helmets, masks, false)).toBe(helmets);
});
