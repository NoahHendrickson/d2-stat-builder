import { beforeEach, test, expect } from "vitest";
import {
  PINS_SCHEMA_VERSION,
  TABLE_PINS_KEY,
  loadTablePins,
  saveTablePins,
  type PersistedTablePins,
} from "./pin-storage";
import { memoryStorage } from "@/lib/test/memory-storage";

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
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
