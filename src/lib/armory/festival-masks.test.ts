import { test, expect } from "vitest";
import {
  FESTIVAL_MASK_CATEGORY_HASH,
  FESTIVAL_MASK_HASHES,
  hashesIncludeHelmet,
  isFestivalMask,
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
