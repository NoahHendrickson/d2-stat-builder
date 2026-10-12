import { describe, expect, test } from "vitest";
import {
  DEFAULT_SET_FILTERS,
  hasActiveSetFilters,
  passesSetFilters,
} from "./set-filters";

describe("passesSetFilters", () => {
  test("with default settings only shows sets with two or more owned pieces", () => {
    expect(passesSetFilters(0, DEFAULT_SET_FILTERS)).toBe(false);
    expect(passesSetFilters(1, DEFAULT_SET_FILTERS)).toBe(false);
    expect(passesSetFilters(2, DEFAULT_SET_FILTERS)).toBe(true);
  });

  test("passes all sets when no sets are hidden", () => {
    const open = { minOwned: 0 } as const;
    expect(passesSetFilters(0, open)).toBe(true);
    expect(passesSetFilters(1, open)).toBe(true);
    expect(passesSetFilters(4, open)).toBe(true);
  });

  test("hides sets under four pieces at the four-piece threshold", () => {
    const four = { minOwned: 4 } as const;
    expect(passesSetFilters(1, four)).toBe(false);
    expect(passesSetFilters(3, four)).toBe(false);
    expect(passesSetFilters(4, four)).toBe(true);
  });
});

describe("hasActiveSetFilters", () => {
  test("returns true for defaults", () => {
    expect(hasActiveSetFilters(DEFAULT_SET_FILTERS)).toBe(true);
  });

  test("returns true at the four-piece threshold", () => {
    expect(hasActiveSetFilters({ minOwned: 4 })).toBe(true);
  });

  test("returns false when no sets are hidden", () => {
    expect(hasActiveSetFilters({ minOwned: 0 })).toBe(false);
  });
});
