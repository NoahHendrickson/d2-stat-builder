import { beforeEach, test, expect } from "vitest";
import { SUBCLASSES, type Subclass } from "../armory/fragments";
import { DEFAULT_SET_FILTERS } from "../armory/set-filters";
import {
  DEFAULT_POWER_RANGE,
  SELECTIONS_KEY,
  SCHEMA_VERSION,
  enteredWeaponPowers,
  forcesDreamersBond,
  includesLegacyArmor,
  parsePowerRange,
  samePowerRangeSelection,
  toOptimizerPowerRange,
  type PersistedSelections,
  fragSelToArrays,
  fragSelFromArrays,
  resolveExoticIndex,
  loadSelections,
  saveSelections,
} from "./selection-storage";

/** Minimal in-memory Storage so the node test env can exercise load/save I/O. */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage =
    new MemStorage() as unknown as Storage;
});

function emptyFragSel(): Record<Subclass, Set<number>> {
  return Object.fromEntries(SUBCLASSES.map((s) => [s, new Set<number>()])) as Record<
    Subclass,
    Set<number>
  >;
}

function sampleSelections(): PersistedSelections {
  const frag = emptyFragSel();
  frag.Prismatic.add(111).add(222);
  frag.Void.add(333);
  return {
    version: SCHEMA_VERSION,
    classType: 2,
    targets: [100, 0, 50, 0, 0, 30],
    major: 3,
    setReqs: { 987654: 4, 123456: 2 },
    pinnedSets: [123456, 555],
    setFilters: { ...DEFAULT_SET_FILTERS, hideZero: false },
    exoticName: "Gyrfalcon's Hauberk",
    exoticPerks: [null, null],
    allowTuning: true,
    balancedTuning: false,
    legacyExotics: false,
    lowerTierArmor: true,
    powerRange: {
      enabled: true,
      bounds: { min: 287, max: 292 },
      weapons: [290, null, 288],
      dreamersBond: true,
      legacyArmor: false,
    },
    activeSubclass: "Void",
    fragSel: fragSelToArrays(frag),
  };
}

test("save then load round-trips every selection field", () => {
  const sel = sampleSelections();
  saveSelections(sel);
  expect(loadSelections()).toEqual(sel);
});

test("load returns null when nothing is stored", () => {
  expect(loadSelections()).toBeNull();
});

test("load returns null on a schema version mismatch", () => {
  const stale = { ...sampleSelections(), version: SCHEMA_VERSION + 1 };
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(stale));
  expect(loadSelections()).toBeNull();
});

test("load returns null on corrupt JSON", () => {
  localStorage.setItem(SELECTIONS_KEY, "{not valid json");
  expect(loadSelections()).toBeNull();
});

test("load defaults exoticPerks to Any/Any for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.exoticPerks;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, exoticPerks: [null, null] });
});

test("load defaults pinnedSets to [] for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.pinnedSets;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, pinnedSets: [] });
});

test("load defaults balancedTuning to true for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.balancedTuning;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, balancedTuning: true });
});

test("load defaults legacyExotics to true for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.legacyExotics;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, legacyExotics: true });
});

test("load defaults lowerTierArmor to false for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.lowerTierArmor;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, lowerTierArmor: false });
});

test("load ignores the retired top-level dreamersBond / festivalMasks pins", () => {
  const old = { ...sampleSelections(), dreamersBond: true, festivalMasks: true };
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual(sampleSelections());
});

test("load defaults powerRange to off for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.powerRange;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, powerRange: DEFAULT_POWER_RANGE });
});

test("parsePowerRange orders an inverted range, drops a non-integer one and bad weapon slots", () => {
  expect(
    parsePowerRange({ enabled: true, bounds: { min: 292, max: 287 }, weapons: [null, null, null] }),
  ).toEqual({
    enabled: true,
    bounds: { min: 287, max: 292 },
    weapons: [null, null, null],
    dreamersBond: false,
    legacyArmor: false,
  });
  expect(parsePowerRange({ enabled: true, bounds: { min: -1, max: 287 } })).toEqual(
    DEFAULT_POWER_RANGE,
  );
  expect(parsePowerRange({ enabled: true, bounds: { min: 287.5, max: 292 } })).toEqual(
    DEFAULT_POWER_RANGE,
  );
  expect(parsePowerRange({ enabled: true, bounds: 5 })).toEqual(DEFAULT_POWER_RANGE);
  expect(parsePowerRange({ enabled: "yes", bounds: { min: 287, max: 292 } })).toEqual(
    DEFAULT_POWER_RANGE,
  );
  // Unset bounds are legal in either toggle state.
  expect(parsePowerRange({ enabled: true })).toEqual({ ...DEFAULT_POWER_RANGE, enabled: true });
  expect(
    parsePowerRange({ enabled: false, bounds: { min: 287, max: 292 }, weapons: [290, -1, 2.5] }),
  ).toEqual({
    enabled: false,
    bounds: { min: 287, max: 292 },
    weapons: [290, null, null],
    dreamersBond: false,
    legacyArmor: false,
  });
  expect(
    enteredWeaponPowers({ ...DEFAULT_POWER_RANGE, enabled: true, weapons: [290, null, 288] }),
  ).toEqual([290, 288]);
});

test("parsePowerRange reads dreamersBond, defaulting anything but true to off", () => {
  expect(parsePowerRange({ enabled: true, dreamersBond: true }).dreamersBond).toBe(true);
  expect(parsePowerRange({ enabled: true, dreamersBond: "yes" }).dreamersBond).toBe(false);
  expect(parsePowerRange({ enabled: true }).dreamersBond).toBe(false);
});

test("forcesDreamersBond only while Power matters is on", () => {
  const checked = { ...DEFAULT_POWER_RANGE, dreamersBond: true };
  expect(forcesDreamersBond({ ...checked, enabled: true })).toBe(true);
  expect(forcesDreamersBond({ ...checked, enabled: false })).toBe(false);
  expect(forcesDreamersBond({ ...DEFAULT_POWER_RANGE, enabled: true })).toBe(false);
});

test("parsePowerRange reads legacyArmor, defaulting anything but true to off", () => {
  expect(parsePowerRange({ enabled: true, legacyArmor: true }).legacyArmor).toBe(true);
  expect(parsePowerRange({ enabled: true, legacyArmor: 1 }).legacyArmor).toBe(false);
  expect(parsePowerRange({ enabled: true }).legacyArmor).toBe(false);
});

test("includesLegacyArmor only while Power matters is on", () => {
  const checked = { ...DEFAULT_POWER_RANGE, legacyArmor: true };
  expect(includesLegacyArmor({ ...checked, enabled: true })).toBe(true);
  expect(includesLegacyArmor({ ...checked, enabled: false })).toBe(false);
  expect(includesLegacyArmor({ ...DEFAULT_POWER_RANGE, enabled: true })).toBe(false);
});

test("toOptimizerPowerRange is undefined unless enabled with bounds set", () => {
  const on: PersistedSelections["powerRange"] = {
    enabled: true,
    bounds: { min: 287, max: 292 },
    weapons: [290, null, 288],
    dreamersBond: false,
    legacyArmor: false,
  };
  expect(toOptimizerPowerRange(on)).toEqual({ min: 287, max: 292, weapons: [290, 288] });
  expect(toOptimizerPowerRange({ ...on, enabled: false })).toBeUndefined();
  expect(toOptimizerPowerRange({ ...on, bounds: null })).toBeUndefined();
});

test("load defaults setFilters for data stored before the field existed", () => {
  const old: Partial<PersistedSelections> = sampleSelections();
  delete old.setFilters;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(old));
  expect(loadSelections()).toEqual({ ...old, setFilters: DEFAULT_SET_FILTERS });
});

test("load upgrades legacy all-false hide toggles to new defaults", () => {
  const old = sampleSelections();
  localStorage.setItem(
    SELECTIONS_KEY,
    JSON.stringify({
      ...old,
      setFilters: {
        only4pc: false,
        only2pc: false,
        hideLessThan2: false,
        hideZero: false,
      },
    }),
  );
  expect(loadSelections()?.setFilters).toEqual(DEFAULT_SET_FILTERS);
});

test("load preserves explicit hide choices in the new two-toggle schema", () => {
  const old = sampleSelections();
  localStorage.setItem(
    SELECTIONS_KEY,
    JSON.stringify({
      ...old,
      setFilters: { hideZero: false, hideLessThan2: true },
    }),
  );
  expect(loadSelections()?.setFilters).toEqual({
    hideZero: false,
    hideLessThan2: true,
  });
});

test("load returns null when the shape is malformed (targets wrong length)", () => {
  const bad = { ...sampleSelections(), targets: [1, 2, 3] };
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(bad));
  expect(loadSelections()).toBeNull();
});

test("fragSelToArrays serializes every subclass's Set to an array", () => {
  const frag = emptyFragSel();
  frag.Solar.add(5).add(9);
  const out = fragSelToArrays(frag);
  expect(out.Solar).toEqual([5, 9]);
  expect(out.Arc).toEqual([]);
  expect(Object.keys(out).sort()).toEqual([...SUBCLASSES].sort());
});

test("fragSelFromArrays rehydrates Sets and ignores unknown subclass keys", () => {
  const restored = fragSelFromArrays({
    Solar: [5, 9],
    Bogus: [1],
  } as unknown as Record<Subclass, number[]>);
  expect(restored.Solar).toEqual(new Set([5, 9]));
  expect(restored.Arc).toEqual(new Set());
  expect(Object.keys(restored).sort()).toEqual([...SUBCLASSES].sort());
  expect((restored as Record<string, unknown>).Bogus).toBeUndefined();
});

test("resolveExoticIndex finds the matching name by identity", () => {
  const exotics = [{ name: "Assassin's Cowl" }, { name: "Gyrfalcon's Hauberk" }];
  expect(resolveExoticIndex("Gyrfalcon's Hauberk", exotics)).toBe(1);
});

test("resolveExoticIndex returns null when the exotic is no longer owned", () => {
  const exotics = [{ name: "Assassin's Cowl" }];
  expect(resolveExoticIndex("Gyrfalcon's Hauberk", exotics)).toBeNull();
});

test("resolveExoticIndex returns null for a null name", () => {
  expect(resolveExoticIndex(null, [{ name: "Assassin's Cowl" }])).toBeNull();
});

test("samePowerRangeSelection compares by value, bounds and weapons included", () => {
  const on: PersistedSelections["powerRange"] = {
    enabled: true,
    bounds: { min: 287, max: 292 },
    weapons: [290, null, 288],
    dreamersBond: false,
    legacyArmor: false,
  };
  expect(samePowerRangeSelection(on, { ...on, bounds: { min: 287, max: 292 } })).toBe(true);
  expect(samePowerRangeSelection(on, { ...on, weapons: [290, null, 288] })).toBe(true);
  expect(samePowerRangeSelection(on, { ...on, bounds: { min: 288, max: 292 } })).toBe(false);
  expect(samePowerRangeSelection(on, { ...on, bounds: null })).toBe(false);
  expect(samePowerRangeSelection(on, { ...on, weapons: [290, 300, 288] })).toBe(false);
  expect(samePowerRangeSelection(on, { ...on, enabled: false })).toBe(false);
  expect(samePowerRangeSelection(on, { ...on, dreamersBond: true })).toBe(false);
  expect(samePowerRangeSelection(on, { ...on, legacyArmor: true })).toBe(false);
  expect(samePowerRangeSelection({ ...on, bounds: null }, { ...on, bounds: null })).toBe(true);
});
