import { describe, expect, test } from "vitest";
import {
  DEFAULT_SET_FILTERS,
  countActiveSetFilters,
  hasActiveSetFilters,
  passesSetFilters,
} from "./set-filters";

describe("passesSetFilters", () => {
  test("with default settings only shows sets with two or more owned pieces", () => {
    expect(passesSetFilters(0, DEFAULT_SET_FILTERS)).toBe(false);
    expect(passesSetFilters(1, DEFAULT_SET_FILTERS)).toBe(false);
    expect(passesSetFilters(2, DEFAULT_SET_FILTERS)).toBe(true);
  });

  test("passes all sets when every setting is off", () => {
    const open = { hideLessThan2: false, hideZero: false };
    expect(passesSetFilters(0, open)).toBe(true);
    expect(passesSetFilters(4, open)).toBe(true);
  });

  test("hideLessThan2 hides sets with fewer than two pieces", () => {
    const filters = { hideZero: false, hideLessThan2: true };
    expect(passesSetFilters(1, filters)).toBe(false);
    expect(passesSetFilters(2, filters)).toBe(true);
  });

  test("hideZero hides sets with no owned pieces", () => {
    const filters = { hideLessThan2: false, hideZero: true };
    expect(passesSetFilters(0, filters)).toBe(false);
    expect(passesSetFilters(1, filters)).toBe(true);
  });

  test("combines active settings with AND semantics", () => {
    expect(passesSetFilters(1, DEFAULT_SET_FILTERS)).toBe(false);
    expect(passesSetFilters(2, DEFAULT_SET_FILTERS)).toBe(true);
  });
});

describe("countActiveSetFilters", () => {
  test("returns two for default settings", () => {
    expect(countActiveSetFilters(DEFAULT_SET_FILTERS)).toBe(2);
  });

  test("counts each enabled setting", () => {
    expect(
      countActiveSetFilters({
        hideLessThan2: false,
        hideZero: true,
      }),
    ).toBe(1);
  });
});

describe("hasActiveSetFilters", () => {
  test("returns true for defaults", () => {
    expect(hasActiveSetFilters(DEFAULT_SET_FILTERS)).toBe(true);
  });

  test("returns false when every setting is off", () => {
    expect(
      hasActiveSetFilters({
        hideLessThan2: false,
        hideZero: false,
      }),
    ).toBe(false);
  });
});
