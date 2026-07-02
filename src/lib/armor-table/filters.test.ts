import { test, expect } from "vitest";
import {
  emptyFilters,
  hasActiveFilters,
  pieceMatchesFilters,
  type FilterablePiece,
} from "./filters";
import { tokenizeSearchQuery } from "./search";

const piece = (overrides: Partial<FilterablePiece> = {}): FilterablePiece => ({
  name: "Ferropotent Helm",
  classType: 1,
  setHash: 42,
  archetype: "Gunner",
  tunedStat: 0,
  ...overrides,
});

test("empty filters match everything", () => {
  expect(hasActiveFilters(emptyFilters())).toBe(false);
  expect(pieceMatchesFilters(piece(), 3, emptyFilters(), [])).toBe(true);
});

test("multi-select facets OR within and AND across", () => {
  const f = { ...emptyFilters(), classes: [0, 1], archetypes: ["Gunner", "Brawler"] };
  expect(pieceMatchesFilters(piece(), 3, f, [])).toBe(true); // Hunter + Gunner
  expect(pieceMatchesFilters(piece({ classType: 2 }), 3, f, [])).toBe(false); // wrong class
  expect(pieceMatchesFilters(piece({ archetype: "Paragon" }), 3, f, [])).toBe(false);
});

test("pieces missing a field fail that facet when it's active", () => {
  const bySet = { ...emptyFilters(), setHashes: [42] };
  expect(pieceMatchesFilters(piece({ setHash: undefined }), 3, bySet, [])).toBe(false);
  const byTertiary = { ...emptyFilters(), tertiaries: [3] };
  expect(pieceMatchesFilters(piece(), undefined, byTertiary, [])).toBe(false);
});

test('tuning facet: "none" matches untunable pieces, indices match tuned stats', () => {
  const f = { ...emptyFilters(), tunings: ["none" as const, 2] };
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, f, [])).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: 2 }), 3, f, [])).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, f, [])).toBe(false);
});

test("armor version facet filters by tuning socket", () => {
  const only30 = { ...emptyFilters(), armorVersions: ["3.0" as const] };
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, only30, [])).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, only30, [])).toBe(
    false,
  );

  const only20 = { ...emptyFilters(), armorVersions: ["2.0" as const] };
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, only20, [])).toBe(
    true,
  );
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, only20, [])).toBe(false);

  const both = { ...emptyFilters(), armorVersions: ["2.0" as const, "3.0" as const] };
  expect(pieceMatchesFilters(piece({ tunedStat: 0 }), 3, both, [])).toBe(true);
  expect(pieceMatchesFilters(piece({ tunedStat: undefined }), 3, both, [])).toBe(true);
});

test("search tokens AND with the other facets", () => {
  const f = { ...emptyFilters(), classes: [1] };
  const tokens = tokenizeSearchQuery("ferro smoke");
  expect(pieceMatchesFilters(piece(), 3, f, tokens)).toBe(true);
  expect(pieceMatchesFilters(piece({ name: "Iron Will Mask" }), 3, f, tokens)).toBe(false);
});
