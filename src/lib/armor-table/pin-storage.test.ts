import { beforeEach, test, expect } from "vitest";
import {
  PINS_SCHEMA_VERSION,
  TABLE_PINS_KEY,
  loadTablePins,
  saveTablePins,
  type PersistedTablePins,
} from "./pin-storage";

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

function samplePins(): PersistedTablePins {
  return {
    version: PINS_SCHEMA_VERSION,
    sets: [123456, 789],
    archetypes: ["Gunner", "Brawler"],
  };
}

test("round-trips pins in pin order", () => {
  saveTablePins(samplePins());
  expect(loadTablePins()).toEqual(samplePins());
});

test("returns null when absent, corrupt, or a different schema version", () => {
  expect(loadTablePins()).toBeNull();
  localStorage.setItem(TABLE_PINS_KEY, "{not json");
  expect(loadTablePins()).toBeNull();
  localStorage.setItem(
    TABLE_PINS_KEY,
    JSON.stringify({ ...samplePins(), version: PINS_SCHEMA_VERSION + 1 }),
  );
  expect(loadTablePins()).toBeNull();
});

test("filters out wrongly-typed entries", () => {
  localStorage.setItem(
    TABLE_PINS_KEY,
    JSON.stringify({
      version: PINS_SCHEMA_VERSION,
      sets: [1, "2", null],
      archetypes: ["Gunner", 7],
    }),
  );
  expect(loadTablePins()).toEqual({
    version: PINS_SCHEMA_VERSION,
    sets: [1],
    archetypes: ["Gunner"],
  });
});
