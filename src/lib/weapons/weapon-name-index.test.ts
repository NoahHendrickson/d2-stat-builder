import { describe, expect, test } from "vitest";

import { sampleWeapons } from "./fixtures/sample-weapons";
import { internWeaponCatalog } from "./intern-weapons";
import {
  buildWeaponNameIndex,
  createWeaponSearcher,
  filterWeaponNames,
  rankWeaponResults,
  weaponsMatchingTextQuery,
} from "./search";

const { index } = internWeaponCatalog(sampleWeapons, "sample");
const weapons = index.weapons;
const nameIndex = buildWeaponNameIndex(weapons);

describe("buildWeaponNameIndex", () => {
  test("indexes every distinct name with counts and weapon lists", () => {
    expect(nameIndex.names.length).toBeGreaterThan(0);
    for (const name of nameIndex.names) {
      const list = nameIndex.byName.get(name)!;
      expect(list.length).toBe(nameIndex.countByName.get(name));
      expect(list.every((w) => w.name === name)).toBe(true);
    }
  });

  test("names and namesLower stay parallel and sorted", () => {
    const sorted = [...nameIndex.names].sort((a, b) => a.localeCompare(b));
    expect(nameIndex.names).toEqual(sorted);
    expect(nameIndex.namesLower).toEqual(nameIndex.names.map((n) => n.toLowerCase()));
  });
});

describe("name search parity with/without prebuilt index", () => {
  const queries = ["fate", "f", "storm", "the", "xyz-no-match"];

  test("filterWeaponNames returns identical results either way", () => {
    for (const q of queries) {
      expect(filterWeaponNames(weapons, q, nameIndex)).toEqual(filterWeaponNames(weapons, q));
    }
    expect(filterWeaponNames(weapons, "", nameIndex)).toEqual([]);
  });

  test("weaponsMatchingTextQuery returns identical results either way", () => {
    const searcher = createWeaponSearcher(weapons);
    for (const q of queries) {
      const withIndex = weaponsMatchingTextQuery(weapons, searcher, q, 50, nameIndex).map((w) => w.hash);
      const without = weaponsMatchingTextQuery(weapons, searcher, q, 50).map((w) => w.hash);
      expect(withIndex).toEqual(without);
    }
  });

  test("rankWeaponResults returns identical order either way", () => {
    for (const q of queries) {
      const withIndex = rankWeaponResults(weapons, q, "name", nameIndex).map((w) => w.hash);
      const without = rankWeaponResults(weapons, q, "name").map((w) => w.hash);
      expect(withIndex).toEqual(without);
    }
  });
});
