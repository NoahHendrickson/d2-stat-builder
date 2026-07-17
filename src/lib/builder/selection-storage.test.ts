import { beforeEach, test, expect } from "vitest";
import { SUBCLASSES, type Subclass } from "../armory/fragments";
import { DEFAULT_SET_FILTERS } from "../armory/set-filters";
import {
  SELECTIONS_KEY,
  SCHEMA_VERSION,
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
