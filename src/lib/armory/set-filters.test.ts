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

  test("passes all sets when sets under two pieces are shown", () => {
    const open = { hideLessThan2: false };
    expect(passesSetFilters(0, open)).toBe(true);
    expect(passesSetFilters(1, open)).toBe(true);
    expect(passesSetFilters(4, open)).toBe(true);
  });
});

describe("hasActiveSetFilters", () => {
  test("returns true for defaults", () => {
    expect(hasActiveSetFilters(DEFAULT_SET_FILTERS)).toBe(true);
  });

  test("returns false when sets under two pieces are shown", () => {
    expect(hasActiveSetFilters({ hideLessThan2: false })).toBe(false);
  });
});
