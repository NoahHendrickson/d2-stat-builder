import { describe, expect, test } from "vitest";

import { sampleWeapons } from "./fixtures/sample-weapons";
import { internWeaponCatalog } from "./intern-weapons";
import {
  buildWeaponNameIndex,
  createWeaponSearcher,
  filterWeaponNames,
  rankWeaponResults,
  suggestWeaponNames,
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
      const withIndex = rankWeaponResults(weapons, q, "name", undefined, nameIndex).map((w) => w.hash);
      const without = rankWeaponResults(weapons, q, "name").map((w) => w.hash);
      expect(withIndex).toEqual(without);
    }
  });
});

describe("popularity tiebreak", () => {
  test("suggestWeaponNames promotes a popular name on equal match rank", () => {
    // Two distinct single-char-prefix names sharing rank; popularity should reorder.
    const matches = filterWeaponNames(weapons, "", nameIndex);
    expect(matches).toEqual([]); // empty query yields nothing

    const all = suggestWeaponNames(weapons, weapons[0]!.name.slice(0, 1), 50, nameIndex);
    expect(all.length).toBeGreaterThan(0);

    // Pick two names with the same search rank for the prefix, then boost the second.
    const prefix = weapons[0]!.name.slice(0, 1).toLowerCase();
    const sameRank = filterWeaponNames(weapons, prefix, nameIndex)
      .filter((m) => m.searchRank === 1)
      .map((m) => m.value);
    if (sameRank.length >= 2) {
      const boosted = sameRank[1]!;
      const popularity = new Map<string, number>([[boosted.toLowerCase(), 999]]);
      const ranked = suggestWeaponNames(weapons, prefix, 50, nameIndex, popularity).map((o) => o.value);
      const others = sameRank.filter((n) => n !== boosted);
      for (const other of others) {
        expect(ranked.indexOf(boosted)).toBeLessThan(ranked.indexOf(other));
      }
    }
  });
});
