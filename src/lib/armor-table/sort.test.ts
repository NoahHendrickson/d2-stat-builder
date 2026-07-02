import { test, expect } from "vitest";
import { compareRows, sortValue, type SortableRow } from "./sort";

const row = (over: {
  name?: string;
  slot?: SortableRow["piece"]["slot"];
  stats?: number[];
  archetype?: string;
  tertiary?: number;
  setName?: string;
}): SortableRow => ({
  piece: {
    name: over.name ?? "Test Piece",
    classType: 1,
    slot: over.slot ?? "helmet",
    location: "vault",
    stats: over.stats ?? [10, 10, 10, 10, 10, 10],
    archetype: over.archetype,
  },
  setName: over.setName,
  tertiary: over.tertiary,
});

test("sortValue reads stat columns by STAT_ORDER index", () => {
  const r = row({ stats: [1, 2, 3, 4, 5, 6] });
  expect(sortValue(r, "stat-weapons")).toBe(1);
  expect(sortValue(r, "stat-super")).toBe(5);
});

test("compareRows sorts numbers numerically and flips with direction", () => {
  const lo = row({ stats: [5, 0, 0, 0, 0, 0] });
  const hi = row({ stats: [30, 0, 0, 0, 0, 0] });
  expect(compareRows(lo, hi, { key: "stat-weapons", asc: true })).toBeLessThan(0);
  expect(compareRows(lo, hi, { key: "stat-weapons", asc: false })).toBeGreaterThan(0);
});

test("compareRows puts missing values last in both directions", () => {
  const has = row({ archetype: "Gunner" });
  const missing = row({});
  expect(compareRows(missing, has, { key: "archetype", asc: true })).toBeGreaterThan(0);
  expect(compareRows(missing, has, { key: "archetype", asc: false })).toBeGreaterThan(0);
  expect(compareRows(missing, missing, { key: "archetype", asc: true })).toBe(0);
});

test("compareRows sorts tertiary by stat label", () => {
  // STAT_ORDER: weapons(0), grenade(3) → labels "Weapons" vs "Grenade"
  const weapons = row({ tertiary: 0 });
  const grenade = row({ tertiary: 3 });
  expect(
    compareRows(grenade, weapons, { key: "tertiary", asc: true }),
  ).toBeLessThan(0);
});
