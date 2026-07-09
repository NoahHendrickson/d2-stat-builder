import { beforeEach, test, expect } from "vitest";
import { emptyFilters } from "./filters";
import {
  TABLE_SCHEMA_VERSION,
  TABLE_STATE_KEY,
  loadTableState,
  saveTableState,
  type PersistedTableState,
} from "./filter-storage";

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

function sampleState(): PersistedTableState {
  return {
    version: TABLE_SCHEMA_VERSION,
    filters: {
      search: "ferro",
      classes: [0, 2],
      setHashes: [123456],
      archetypes: ["Gunner"],
      tunings: ["none", 4],
      tertiaries: [3],
      armorVersions: ["3.0"],
    },
    sort: [
      { key: "archetype", asc: true },
      { key: "stat-super", asc: false },
    ],
    customOrders: { archetype: ["Powerhouse", "Gunner"] },
  };
}

test("round-trips a full state", () => {
  saveTableState(sampleState());
  expect(loadTableState()).toEqual(sampleState());
});

test("returns null when absent, corrupt, or a different schema version", () => {
  expect(loadTableState()).toBeNull();
  localStorage.setItem(TABLE_STATE_KEY, "{not json");
  expect(loadTableState()).toBeNull();
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({ ...sampleState(), version: TABLE_SCHEMA_VERSION + 1 }),
  );
  expect(loadTableState()).toBeNull();
});

test("drops invalid entries and falls back to defaults", () => {
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({
      version: TABLE_SCHEMA_VERSION,
      filters: {
        search: 7, // wrong type
        classes: [1, "x"],
        armorVersions: ["3.0", "4.0"],
        tunings: [2, "sometimes"],
      },
      sort: [{ key: "not-a-column", asc: true }],
    }),
  );
  expect(loadTableState()).toEqual({
    version: TABLE_SCHEMA_VERSION,
    filters: {
      ...emptyFilters(),
      classes: [1],
      armorVersions: ["3.0"],
      tunings: [2],
    },
    sort: [{ key: "name", asc: true }],
    customOrders: {},
  });
});

test("drops custom orders for unknown columns or non-string lists", () => {
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({
      version: TABLE_SCHEMA_VERSION,
      filters: emptyFilters(),
      sort: [],
      customOrders: {
        archetype: ["Gunner", "Brawler"],
        name: ["not orderable"],
        tuned: ["Health", 7],
      },
    }),
  );
  expect(loadTableState()?.customOrders).toEqual({
    archetype: ["Gunner", "Brawler"],
  });
  expect(loadTableState()?.sort).toEqual([]);
});

test("falls back to default sort when saved sort key was removed", () => {
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({
      version: TABLE_SCHEMA_VERSION,
      filters: emptyFilters(),
      sort: [{ key: "slot", asc: false }],
    }),
  );
  expect(loadTableState()?.sort).toEqual([{ key: "name", asc: true }]);
});

test("round-trips an explicit empty (unsorted) sort", () => {
  const state = { ...sampleState(), sort: [] };
  saveTableState(state);
  expect(loadTableState()).toEqual(state);
});

test("migrates v2 single-object sort into a one-element chain", () => {
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({
      version: 2,
      filters: emptyFilters(),
      sort: { key: "stat-super", asc: false },
      customOrders: { archetype: ["Powerhouse", "Gunner"] },
    }),
  );
  expect(loadTableState()).toEqual({
    version: TABLE_SCHEMA_VERSION,
    filters: emptyFilters(),
    sort: [{ key: "stat-super", asc: false }],
    customOrders: { archetype: ["Powerhouse", "Gunner"] },
  });
});

test("migrates v2 null sort to an empty chain", () => {
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({
      version: 2,
      filters: emptyFilters(),
      sort: null,
      customOrders: {},
    }),
  );
  expect(loadTableState()?.sort).toEqual([]);
});

test("dedupes duplicate keys in a nest chain", () => {
  localStorage.setItem(
    TABLE_STATE_KEY,
    JSON.stringify({
      version: TABLE_SCHEMA_VERSION,
      filters: emptyFilters(),
      sort: [
        { key: "archetype", asc: true },
        { key: "archetype", asc: false },
        { key: "name", asc: true },
      ],
    }),
  );
  expect(loadTableState()?.sort).toEqual([
    { key: "archetype", asc: true },
    { key: "name", asc: true },
  ]);
});
