import { beforeEach, test, expect } from "vitest";
import {
  DROPS_KEY,
  DROPS_SCHEMA_VERSION,
  acknowledge,
  acknowledgeAll,
  feedIds,
  loadDrops,
  reconcileSeen,
  saveDrops,
  type SeenMap,
} from "./drops-storage";

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

const NOW = 1_750_000_000_000;

test("first-ever visit seeds every id silently (nothing feed-worthy)", () => {
  const seen = reconcileSeen(null, ["a", "b"], NOW);
  expect(seen).toEqual({ a: 0, b: 0 });
  expect(feedIds(seen)).toEqual([]);
});

test("reconcile stamps only new ids and preserves existing timestamps", () => {
  const prev: SeenMap = { a: 0, b: 123 };
  const next = reconcileSeen(prev, ["a", "b", "c"], NOW);
  expect(next).toEqual({ a: 0, b: 123, c: NOW });
});

test("reconcile prunes ids no longer in the inventory", () => {
  const prev: SeenMap = { a: 0, b: 123, gone: 456 };
  expect(reconcileSeen(prev, ["a", "b"], NOW)).toEqual({ a: 0, b: 123 });
});

test("reconcile returns the same reference when nothing changed", () => {
  const prev: SeenMap = { a: 0, b: 123 };
  expect(reconcileSeen(prev, ["b", "a"], NOW)).toBe(prev);
});

test("acknowledge zeroes one entry; no-op when unknown or already zero", () => {
  const seen: SeenMap = { a: 0, b: 123 };
  expect(acknowledge(seen, "b")).toEqual({ a: 0, b: 0 });
  expect(acknowledge(seen, "a")).toBe(seen);
  expect(acknowledge(seen, "nope")).toBe(seen);
});

test("acknowledgeAll zeroes everything; no-op when already clear", () => {
  expect(acknowledgeAll({ a: 5, b: 0 })).toEqual({ a: 0, b: 0 });
  const clear: SeenMap = { a: 0 };
  expect(acknowledgeAll(clear)).toBe(clear);
});

test("feedIds returns non-zero entries newest first, capped", () => {
  const seen: SeenMap = { a: 100, b: 0, c: 300, d: 200 };
  expect(feedIds(seen)).toEqual([
    { id: "c", firstSeen: 300 },
    { id: "d", firstSeen: 200 },
    { id: "a", firstSeen: 100 },
  ]);
  expect(feedIds(seen, 2)).toHaveLength(2);
});

test("round-trips through storage and drops invalid entries", () => {
  saveDrops({ version: DROPS_SCHEMA_VERSION, seen: { a: 0, b: NOW } });
  expect(loadDrops()).toEqual({
    version: DROPS_SCHEMA_VERSION,
    seen: { a: 0, b: NOW },
  });

  localStorage.setItem(
    DROPS_KEY,
    JSON.stringify({
      version: DROPS_SCHEMA_VERSION,
      seen: { a: 1, bad: "x", negative: -5, nan: null },
    }),
  );
  expect(loadDrops()).toEqual({ version: DROPS_SCHEMA_VERSION, seen: { a: 1 } });
});

test("returns null when absent, corrupt, or a different schema version", () => {
  expect(loadDrops()).toBeNull();
  localStorage.setItem(DROPS_KEY, "{not json");
  expect(loadDrops()).toBeNull();
  localStorage.setItem(
    DROPS_KEY,
    JSON.stringify({ version: DROPS_SCHEMA_VERSION + 1, seen: {} }),
  );
  expect(loadDrops()).toBeNull();
});
