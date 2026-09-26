import { test, expect } from "vitest";
import {
  ARMOR_BUCKETS,
  ARMOR_SLOTS,
  offArchetypeIndices,
  SLOT_BUCKETS,
  tertiaryStatIndex,
  type StatArray,
} from "./stats";

test("tertiaryStatIndex picks the 3rd-highest base-roll stat (the fixed 20)", () => {
  // Archetype weapons/super/grenade = 30/25/20 → tertiary is grenade (index 3).
  const base: StatArray = [30, 0, 0, 20, 25, 0];
  expect(tertiaryStatIndex(base)).toBe(3);
});

test("tertiaryStatIndex is the complement of offArchetypeIndices", () => {
  const base: StatArray = [0, 25, 30, 0, 0, 20];
  expect(tertiaryStatIndex(base)).toBe(5);
  expect(offArchetypeIndices(base)).not.toContain(tertiaryStatIndex(base));
});

test("tertiaryStatIndex resolves ties in STAT_ORDER order (stable sort)", () => {
  // All-equal roll: descending stable sort keeps index order → 3rd is index 2.
  const flat: StatArray = [10, 10, 10, 10, 10, 10];
  expect(tertiaryStatIndex(flat)).toBe(2);
});

test("SLOT_BUCKETS is the exact inverse of ARMOR_BUCKETS", () => {
  expect(Object.keys(SLOT_BUCKETS).sort()).toEqual([...ARMOR_SLOTS].sort());
  for (const slot of ARMOR_SLOTS) {
    expect(ARMOR_BUCKETS[SLOT_BUCKETS[slot] as keyof typeof ARMOR_BUCKETS]).toBe(slot);
  }
});
