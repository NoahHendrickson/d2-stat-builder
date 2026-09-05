import { test, expect } from "vitest";
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
});

test("any-class loadout keeps the current class", () => {
  const s = saved();
  s.loadout.classType = 3;
  expect(selectionsForLoadout(s, existing, { statHashToIndex }).classType).toBe(0);
});
