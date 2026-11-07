import { test, expect } from "vitest";
import {
  blockedLegendarySlots,
  buildOptimizerSlots,
  inDefaultOptimizerPool,
  poolTogglesForSlots,
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

test("blockedLegendarySlots: two slots without a legendary block every build", () => {
  const t5 = { isExotic: false };
  const exotic = { isExotic: true };
  // Arms and legs have only exotics: one exotic can't cover both.
  const slots = [[t5], [exotic], [t5], [exotic], [t5]];
  expect(blockedLegendarySlots(slots, null)).toEqual(["arms", "legs"]);
  expect(blockedLegendarySlots([[t5], [t5], [t5], [t5], [t5]], null)).toEqual([]);
});

test("blockedLegendarySlots: one gap is fine only when an allowed exotic fills it", () => {
  const t5 = { isExotic: false };
  const exotic = { isExotic: true };
  const slots = [[t5], [exotic], [t5], [t5], [t5]];
  expect(blockedLegendarySlots(slots, null)).toEqual([]);
  expect(blockedLegendarySlots(slots, "arms")).toEqual([]);
  // The picked exotic is a helmet, so nothing can go in the arms slot.
  expect(blockedLegendarySlots(slots, "helmet")).toEqual(["arms"]);
  // No exotic in the gap at all.
  expect(blockedLegendarySlots([[t5], [], [t5], [t5], [t5]], null)).toEqual(["arms"]);
});

test("poolTogglesForSlots names the toggles that would fill a gap", () => {
  const piece = (slot: ArmorSlot, extra: object) => ({
    slot,
    isFestivalMask: false,
    isExotic: false,
    ...extra,
  });
  const pieces = [
    piece("arms", { archetype: "Gunner" }), // Tier 1–4
    piece("legs", {}), // Armor 2.0
    piece("chest", { archetype: "Brawler" }),
    { ...piece("arms", {}), isExotic: true },
  ];
  expect(poolTogglesForSlots(pieces, ["arms"], off)).toEqual({
    lowerTierArmor: true,
    legacyArmor: false,
  });
  expect(poolTogglesForSlots(pieces, ["arms", "legs"], off)).toEqual({
    lowerTierArmor: true,
    legacyArmor: true,
  });
  // A toggle that's already on, or only adds pieces elsewhere, isn't offered.
  expect(
    poolTogglesForSlots(pieces, ["arms", "legs"], { ...off, lowerTierArmor: true }),
  ).toEqual({ lowerTierArmor: false, legacyArmor: true });
  expect(poolTogglesForSlots(pieces, ["helmet"], off)).toEqual({
    lowerTierArmor: false,
    legacyArmor: false,
  });
});
