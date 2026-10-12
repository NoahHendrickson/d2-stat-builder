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
    const open = { hideLessThan2: false, hideLessThan4: false };
    expect(passesSetFilters(0, open)).toBe(true);
    expect(passesSetFilters(1, open)).toBe(true);
    expect(passesSetFilters(4, open)).toBe(true);
  });

  test("hides sets under four pieces when that option is on", () => {
    const four = { hideLessThan2: false, hideLessThan4: true };
    expect(passesSetFilters(1, four)).toBe(false);
    expect(passesSetFilters(3, four)).toBe(false);
    expect(passesSetFilters(4, four)).toBe(true);
    expect(passesSetFilters(3, { ...four, hideLessThan2: true })).toBe(false);
  });
});

describe("hasActiveSetFilters", () => {
  test("returns true for defaults", () => {
    expect(hasActiveSetFilters(DEFAULT_SET_FILTERS)).toBe(true);
  });

  test("returns true when only sets under four pieces are hidden", () => {
    expect(
      hasActiveSetFilters({ hideLessThan2: false, hideLessThan4: true }),
    ).toBe(true);
  });

  test("returns false when no sets are hidden", () => {
    expect(
      hasActiveSetFilters({ hideLessThan2: false, hideLessThan4: false }),
    ).toBe(false);
  });
});
