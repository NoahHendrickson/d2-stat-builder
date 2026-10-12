import { test, expect } from "vitest";
import {
  emptyFilters,
  hasActiveFilters,
  pieceMatchesFilters,
  type FilterablePiece,
} from "./filters";
import { normalizeSearchText, searchMatcher, tokenizeSearchQuery } from "./search";

const piece = (overrides: Partial<FilterablePiece> = {}): FilterablePiece => ({
  classType: 1,
  setHash: 42,
  archetype: "Gunner",
  tunedStat: 0,
  ...overrides,
});

test("empty filters match everything", () => {
  expect(hasActiveFilters(emptyFilters())).toBe(false);
  expect(hasActiveFilters({ ...emptyFilters(), search: " - " })).toBe(false);
  expect(hasActiveFilters({ ...emptyFilters(), search: "ferro" })).toBe(true);
  expect(pieceMatchesFilters(piece(), 3, emptyFilters())).toBe(true);
});

test("multi-select facets OR within and AND across", () => {
  const f = { ...emptyFilters(), classes: [0, 1], archetypes: ["Gunner", "Brawler"] };
  expect(pieceMatchesFilters(piece(), 3, f)).toBe(true); // Hunter + Gunner
  expect(pieceMatchesFilters(piece({ classType: 2 }), 3, f)).toBe(false); // wrong class
  expect(pieceMatchesFilters(piece({ archetype: "Paragon" }), 3, f)).toBe(false);
});

test("pieces missing a field fail that facet when it's active", () => {
  const bySet = { ...emptyFilters(), setHashes: [42] };
  expect(pieceMatchesFilters(piece({ setHash: undefined }), 3, bySet)).toBe(false);
  const byTertiary = { ...emptyFilters(), tertiaries: [3] };
  expect(pieceMatchesFilters(piece(), undefined, byTertiary)).toBe(false);
});

test('tuning facet: "none" matches untunable pieces, indices match tuned stats', () => {
  const f = { ...emptyFilters(), tunings: ["none" as const, 2] };
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, f)).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: 2 }), 3, f)).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, f)).toBe(false);
});

test("armor version facet filters by tuning socket", () => {
  const only30 = { ...emptyFilters(), armorVersions: ["3.0" as const] };
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, only30)).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, only30)).toBe(
    false,
  );

  const only20 = { ...emptyFilters(), armorVersions: ["2.0" as const] };
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, only20)).toBe(
    true,
  );
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, only20)).toBe(false);

  const both = { ...emptyFilters(), armorVersions: ["2.0" as const, "3.0" as const] };
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, both)).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, both)).toBe(true);
});

test("search ANDs with the facets, and a facet only narrows it", () => {
  // The armor table's pipeline: search scoped to every row, ANDed with the facets.
  const rows = [
    { name: "No Backup Plans", piece: piece({ classType: 1 }) },
    { name: "Nothing Manacles", piece: piece({ classType: 1 }) },
    { name: "Crown of Tempests", piece: piece({ classType: 2 }) },
  ];
  const visible = (query: string, classes: number[]) => {
    const matches = searchMatcher(
      rows,
      (r) => normalizeSearchText(r.name),
      tokenizeSearchQuery(query),
    );
    const f = { ...emptyFilters(), classes };
    return rows
      .filter((r) => pieceMatchesFilters(r.piece, 3, f) && matches(r))
      .map((r) => r.name);
  };
  expect(visible("no backup plans", [])).toEqual(["No Backup Plans"]);
  expect(visible("no backup plans", [1])).toEqual(["No Backup Plans"]);
  // The best match is a Hunter piece, so on Warlock nothing is left — not every
  // Warlock name with "no" in it.
  expect(visible("no backup plans", [2])).toEqual([]);
  expect(visible("no", [2])).toEqual(["Crown of Tempests"]);
});
