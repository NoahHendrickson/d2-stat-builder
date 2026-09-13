import { test, expect } from "vitest";
import { countMajorStatMods, isMajorStatMod } from "../dim/mod-hashes";
import { selectionsForLoadout } from "./load-in-builder";
import type { SavedLoadout } from "./types";
import type { PersistedSelections } from "../builder/selection-storage";

const existing: PersistedSelections = {
  version: 1,
  classType: 0,
  targets: [9, 9, 9, 9, 9, 9],
  major: 5,
  setReqs: { 1: 2 },
  pinnedSets: [1, 2],
  setFilters: { hideLessThan2: true, hideZero: false },
  exoticName: "Old",
  exoticPerks: [1, 2],
  allowTuning: false,
  balancedTuning: false,
  legacyExotics: false,
  dreamersBond: false,
  festivalMasks: false,
  activeSubclass: "Arc",
  fragSel: { Arc: [5], Solar: [], Void: [], Stasis: [], Strand: [], Prismatic: [7] },
};

const saved = (over: Partial<SavedLoadout> = {}): SavedLoadout => ({
  id: "s",
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  loadout: {
    id: "x",
    name: "n",
    classType: 2,
    equipped: [],
    unequipped: [],
    parameters: {
      mods: [],
      assumeArmorMasterwork: 3,
      statConstraints: [{ statHash: 392767087, minStat: 100 }],
      setBonuses: { 42: 4 },
    },
  },
  ...over,
});

const statHashToIndex = { 392767087: 1 };

test("with a builder snapshot: restores it, keeps pins/filters, merges fragSel", () => {
  const out = selectionsForLoadout(
    saved({
      builder: {
        targets: [0, 100, 0, 0, 0, 0],
        major: 2,
        setReqs: { 42: 4 },
        exoticName: "Cenotaph Mask",
        exoticPerks: [null, null],
        allowTuning: true,
        balancedTuning: true,
        legacyExotics: true,
        dreamersBond: true,
        festivalMasks: true,
        activeSubclass: "Prismatic",
        fragmentHashes: [8, 9],
      },
    }),
    existing,
    { statHashToIndex },
  );
  expect(out.classType).toBe(2);
  expect(out.major).toBe(2);
  expect(out.exoticName).toBe("Cenotaph Mask");
  expect(out.pinnedSets).toEqual([1, 2]);
  expect(out.setFilters).toEqual(existing.setFilters);
  expect(out.activeSubclass).toBe("Prismatic");
  expect(out.fragSel.Prismatic).toEqual([8, 9]);
  expect(out.fragSel.Arc).toEqual([5]);
  expect(out.dreamersBond).toBe(true);
  expect(out.festivalMasks).toBe(true);
});

test("without a snapshot: derives targets/sets from parameters, exotic by name", () => {
  const out = selectionsForLoadout(saved(), null, {
    statHashToIndex,
    exoticName: "Cenotaph Mask",
  });
  expect(out.targets).toEqual([0, 100, 0, 0, 0, 0]);
  expect(out.setReqs).toEqual({ 42: 4 });
  expect(out.exoticName).toBe("Cenotaph Mask");
  expect(out.pinnedSets).toEqual([]);
  expect(out.dreamersBond).toBe(false);
  expect(out.festivalMasks).toBe(false);
});

test("any-class loadout keeps the current class", () => {
  const s = saved();
  s.loadout.classType = 3;
  expect(selectionsForLoadout(s, existing, { statHashToIndex }).classType).toBe(0);
});

test("imports restore the saved subclass and fragments instead of unrelated current selections", () => {
  const out = selectionsForLoadout(saved(), existing, {
    statHashToIndex, subclass: { subclass: "Void", fragmentHashes: [101, 102] },
  });
  expect(out.activeSubclass).toBe("Void");
  expect(out.fragSel.Void).toEqual([101, 102]);
  expect(out.fragSel.Arc).toEqual([5]);
});

test("opts.major overrides a stale builder snapshot (Optimize from edited mods)", () => {
  const out = selectionsForLoadout(
    saved({
      builder: {
        targets: [0, 100, 0, 0, 0, 0],
        major: 0,
        setReqs: {},
        exoticName: null,
        exoticPerks: [null, null],
        allowTuning: true,
        balancedTuning: true,
        legacyExotics: true,
        dreamersBond: false,
        festivalMasks: false,
        activeSubclass: "Prismatic",
        fragmentHashes: [],
      },
    }),
    existing,
    { statHashToIndex, major: 3 },
  );
  expect(out.major).toBe(3);
});

test("without a snapshot, opts.major is the selector value", () => {
  const out = selectionsForLoadout(saved(), null, { statHashToIndex, major: 2 });
  expect(out.major).toBe(2);
});

test("countMajorStatMods counts matching plugs and caps at 5", () => {
  const isMajor = (h: number) => h === 100 || h === 200 || h === 300;
  expect(countMajorStatMods([100, 50, 200, 100], isMajor)).toBe(3);
  expect(countMajorStatMods([100, 100, 100, 100, 200, 300], isMajor)).toBe(5);
  expect(countMajorStatMods([50, 51], isMajor)).toBe(0);
});

test("isMajorStatMod is a general-category +10 armor-stat plug", () => {
  const major = {
    plug: { plugCategoryIdentifier: "enhancements.v2_general" },
    investmentStats: [{ statTypeHash: 392767087, value: 10 }],
  };
  expect(isMajorStatMod(major)).toBe(true);
  expect(isMajorStatMod({ ...major, investmentStats: [{ statTypeHash: 392767087, value: 5 }] })).toBe(false);
  expect(isMajorStatMod(undefined)).toBe(false);
});
