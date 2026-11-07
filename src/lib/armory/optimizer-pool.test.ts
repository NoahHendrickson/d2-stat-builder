import { test, expect } from "vitest";
import {
  blockedLegendarySlots,
  buildOptimizerSlots,
  fillablePoolGap,
  inDefaultOptimizerPool,
} from "./optimizer-pool";
import type { LegacyRaidKey } from "./legacy-raids";
import type { ArmorSlot } from "./stats";

const off = {
  legacyExotics: false,
  lowerTierArmor: false,
  legacyArmor: false,
  legacyRaids: new Set<LegacyRaidKey>(),
};

test("T5 Festival of the Lost masks stay out of the default optimizer pool", () => {
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
  const on = { ...off, lowerTierArmor: true };
  const tier3 = { isFestivalMask: false, archetype: "Gunner", isExotic: false };
  const legacy = { isFestivalMask: false, isExotic: false };
  const tier3Mask = { isFestivalMask: true, archetype: "Gunner", isExotic: false };
  expect(inDefaultOptimizerPool(tier3, on)).toBe(true);
  expect(inDefaultOptimizerPool(tier3, off)).toBe(false);
  expect(inDefaultOptimizerPool(legacy, on)).toBe(false);
  expect(inDefaultOptimizerPool(tier3Mask, on)).toBe(false);
  const lowerExotic = { isFestivalMask: false, archetype: "Brawler", isExotic: true };
  expect(inDefaultOptimizerPool(lowerExotic, on)).toBe(false);
  expect(inDefaultOptimizerPool(lowerExotic, { ...off, legacyExotics: true })).toBe(true);
});

test("legacy Armor 2.0 legendaries join the pool only with legacyArmor on", () => {
  const on = { ...off, legacyArmor: true };
  const legacy = { isFestivalMask: false, isExotic: false };
  expect(inDefaultOptimizerPool(legacy, on)).toBe(true);
  expect(inDefaultOptimizerPool(legacy, off)).toBe(false);
  expect(inDefaultOptimizerPool(legacy, { ...off, lowerTierArmor: true })).toBe(false);
  expect(inDefaultOptimizerPool(legacy, { ...off, legacyExotics: true })).toBe(false);
  expect(inDefaultOptimizerPool({ ...legacy, archetype: "Gunner" }, on)).toBe(false);
  expect(inDefaultOptimizerPool({ ...legacy, isExotic: true }, on)).toBe(false);
  expect(inDefaultOptimizerPool({ ...legacy, isFestivalMask: true }, on)).toBe(false);
});

test("buildOptimizerSlots pins class items and admits legacy class items plus masks", () => {
  const piece = (id: string, slot: ArmorSlot) => ({ id, slot });
  const helmet = piece("h", "helmet");
  const arms = piece("a", "arms");
  const cloak = piece("cloak", "classItem");
  const legacyCloak = piece("legacy-cloak", "classItem");
  const mask = piece("mask", "helmet");
  const slots = buildOptimizerSlots([helmet, arms, cloak, legacyCloak], {
    classItemPieces: [cloak, legacyCloak],
    masks: [mask],
    powerConstrained: true,
  });
  expect(slots[0]!.map((p) => p.id)).toEqual(["h", "mask"]);
  expect(slots[1]!.map((p) => p.id)).toEqual(["a"]);
  expect(slots[4]!.map((p) => p.id)).toEqual(["cloak", "legacy-cloak"]);
});

test("buildOptimizerSlots uses the class-item override (Dreamer's pin)", () => {
  const piece = (id: string, slot: ArmorSlot) => ({ id, slot });
  const dreamers = piece("dreamers", "classItem");
  const cloak = piece("cloak", "classItem");
  const slots = buildOptimizerSlots([cloak], {
    classItemPieces: [dreamers],
    masks: [],
    powerConstrained: false,
  });
  expect(slots[4]!.map((p) => p.id)).toEqual(["dreamers"]);
});

const t5 = { isFestivalMask: false, tunedStat: 1, isExotic: false };
const exotic = { isFestivalMask: false, tunedStat: 1, isExotic: true };

test("blockedLegendarySlots: with any exotic, one gap an exotic can fill is fine, two aren't", () => {
  expect(blockedLegendarySlots([[t5], [t5], [t5], [t5], [t5]], null)).toEqual([]);
  expect(blockedLegendarySlots([[t5], [exotic], [t5], [t5], [t5]], null)).toEqual([]);
  // Arms and legs have only exotics: one exotic can't cover both.
  expect(blockedLegendarySlots([[t5], [exotic], [t5], [exotic], [t5]], null)).toEqual([
    "arms",
    "legs",
  ]);
  // No exotic in the gap at all.
  expect(blockedLegendarySlots([[t5], [], [t5], [t5], [t5]], null)).toEqual(["arms"]);
});

test("blockedLegendarySlots: a picked exotic fills its own slot and no other", () => {
  const armsGap = [[t5], [exotic], [t5], [t5], [t5]];
  expect(blockedLegendarySlots(armsGap, "arms")).toEqual([]);
  // The picked exotic is a helmet, so nothing can go in the arms slot.
  expect(blockedLegendarySlots(armsGap, "helmet")).toEqual(["arms"]);
  // The helmet slot has no legendary either, but the picked helmet covers it.
  expect(blockedLegendarySlots([[exotic], [exotic], [t5], [t5], [t5]], "helmet")).toEqual([
    "arms",
  ]);
});

const piece = (slot: ArmorSlot, extra: object = {}) => ({
  slot,
  isFestivalMask: false,
  isExotic: false,
  ...extra,
});
const lowerTier = (slot: ArmorSlot) => piece(slot, { archetype: "Gunner" });
const legacy = (slot: ArmorSlot) => piece(slot);
// T5 legendaries everywhere but arms and legs, which only have exotics.
const gapSlots = [[t5], [exotic], [t5], [exotic], [t5]];

test("fillablePoolGap: nothing blocked, nothing to offer", () => {
  expect(fillablePoolGap([[t5], [t5], [t5], [t5], [t5]], [lowerTier("arms")], null, off)).toBeNull();
});

test("fillablePoolGap names the one setting that unblocks builds", () => {
  const classPieces = [lowerTier("arms"), lowerTier("legs"), legacy("helmet")];
  expect(fillablePoolGap(gapSlots, classPieces, null, off)).toEqual({
    slots: ["arms", "legs"],
    settings: ["lowerTierArmor"],
    together: false,
    using: [],
  });
});

test("fillablePoolGap offers either setting when each is enough", () => {
  const classPieces = [lowerTier("arms"), lowerTier("legs"), legacy("arms"), legacy("legs")];
  expect(fillablePoolGap(gapSlots, classPieces, null, off)?.settings).toEqual([
    "lowerTierArmor",
    "legacyArmor",
  ]);
});

test("fillablePoolGap: a setting that fills one gap but leaves another isn't offered", () => {
  // A picked helmet exotic, so arms and legs both need a legendary. Lower tier armor only
  // fills arms and Legacy armor only fills legs: both are needed at once.
  const classPieces = [lowerTier("arms"), legacy("legs")];
  expect(fillablePoolGap(gapSlots, classPieces, "helmet", off)).toEqual({
    slots: ["arms", "legs"],
    settings: ["lowerTierArmor", "legacyArmor"],
    together: true,
    using: [],
  });
  // Nothing at all for legs: no setting helps, so there's no notice.
  expect(fillablePoolGap(gapSlots, [lowerTier("arms")], "helmet", off)).toBeNull();
});

test("fillablePoolGap skips settings already on and reports them", () => {
  const on = { ...off, legacyArmor: true };
  const classPieces = [lowerTier("arms"), lowerTier("legs"), legacy("helmet")];
  expect(fillablePoolGap(gapSlots, classPieces, null, on)).toEqual({
    slots: ["arms", "legs"],
    settings: ["lowerTierArmor"],
    together: false,
    using: ["legacyArmor"],
  });
});
