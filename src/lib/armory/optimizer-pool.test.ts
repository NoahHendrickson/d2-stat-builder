import { test, expect } from "vitest";
import {
  buildOptimizerSlots,
  inDefaultOptimizerPool,
} from "./optimizer-pool";
import type { ArmorSlot } from "./stats";

const off = { legacyExotics: false, lowerTierArmor: false, legacyArmor: false };

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
