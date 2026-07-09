import { test, expect } from "vitest";
import {
  activeSortMode,
  applySortLevel,
  clearCustomOrder,
  compareRows,
  isStatSortKey,
  moveOrderItem,
  preferredAsc,
  removeSortLevel,
  sortIndexOf,
  sortValue,
  type SortableRow,
} from "./sort";

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
  expect(
    compareRows(lo, hi, [{ key: "stat-weapons", asc: true }]),
  ).toBeLessThan(0);
  expect(
    compareRows(lo, hi, [{ key: "stat-weapons", asc: false }]),
  ).toBeGreaterThan(0);
});

test("compareRows puts missing values last in both directions", () => {
  const has = row({ archetype: "Gunner" });
  const missing = row({});
  expect(
    compareRows(missing, has, [{ key: "archetype", asc: true }]),
  ).toBeGreaterThan(0);
  expect(
    compareRows(missing, has, [{ key: "archetype", asc: false }]),
  ).toBeGreaterThan(0);
  expect(
    compareRows(missing, missing, [{ key: "archetype", asc: true }]),
  ).toBe(0);
});

test("compareRows sorts tertiary by stat label", () => {
  // STAT_ORDER: weapons(0), grenade(3) → labels "Weapons" vs "Grenade"
  const weapons = row({ tertiary: 0 });
  const grenade = row({ tertiary: 3 });
  expect(
    compareRows(grenade, weapons, [{ key: "tertiary", asc: true }]),
  ).toBeLessThan(0);
});

test("preferredAsc is ascending for text columns and descending for stats", () => {
  expect(preferredAsc("name")).toBe(true);
  expect(preferredAsc("stat-weapons")).toBe(false);
});

test("isStatSortKey distinguishes stat columns from text columns", () => {
  expect(isStatSortKey("stat-weapons")).toBe(true);
  expect(isStatSortKey("name")).toBe(false);
  expect(isStatSortKey("class")).toBe(false);
});

test("activeSortMode reflects direction, custom order, or inactive column", () => {
  expect(activeSortMode([], "name")).toBeNull();
  expect(activeSortMode([{ key: "name", asc: true }], "name")).toBe("asc");
  expect(activeSortMode([{ key: "name", asc: false }], "name")).toBe("desc");
  expect(activeSortMode([{ key: "name", asc: true }], "class")).toBeNull();
  // Custom order only wins when that column is in the chain.
  expect(
    activeSortMode([{ key: "archetype", asc: true }], "archetype", {
      archetype: ["Powerhouse", "Gunner"],
    }),
  ).toBe("custom");
  expect(
    activeSortMode([{ key: "name", asc: true }], "archetype", {
      archetype: ["Powerhouse"],
    }),
  ).toBeNull();
});

test("applySortLevel replaces, nests, or updates in place", () => {
  expect(applySortLevel([], "name", "asc", false)).toEqual([
    { key: "name", asc: true },
  ]);
  expect(
    applySortLevel([{ key: "name", asc: true }], "archetype", "desc", false),
  ).toEqual([{ key: "archetype", asc: false }]);
  expect(
    applySortLevel([{ key: "name", asc: true }], "archetype", "asc", true),
  ).toEqual([
    { key: "name", asc: true },
    { key: "archetype", asc: true },
  ]);
  // Already in chain → update that level; nest flag ignored.
  expect(
    applySortLevel(
      [
        { key: "name", asc: true },
        { key: "archetype", asc: true },
      ],
      "archetype",
      "desc",
      true,
    ),
  ).toEqual([
    { key: "name", asc: true },
    { key: "archetype", asc: false },
  ]);
});

test("removeSortLevel drops one column and keeps later levels", () => {
  const chain = [
    { key: "archetype" as const, asc: true },
    { key: "tertiary" as const, asc: true },
    { key: "name" as const, asc: true },
  ];
  expect(removeSortLevel(chain, "tertiary")).toEqual([
    { key: "archetype", asc: true },
    { key: "name", asc: true },
  ]);
  expect(removeSortLevel(chain, "archetype")).toEqual([
    { key: "tertiary", asc: true },
    { key: "name", asc: true },
  ]);
  expect(sortIndexOf(chain, "name")).toBe(2);
});

test("clearCustomOrder removes one column without touching others", () => {
  const orders = {
    archetype: ["Powerhouse", "Gunner"],
    class: ["Titan", "Hunter"],
  };
  expect(clearCustomOrder(orders, "archetype")).toEqual({
    class: ["Titan", "Hunter"],
  });
  expect(clearCustomOrder(orders, "set")).toEqual(orders);
});

test("moveOrderItem reorders by moving from → to", () => {
  expect(moveOrderItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  expect(moveOrderItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  expect(moveOrderItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
});

test("compareRows follows a custom value order for its column", () => {
  const gunner = row({ archetype: "Gunner" });
  const powerhouse = row({ archetype: "Powerhouse" });
  const orders = { archetype: ["Powerhouse", "Gunner"] };
  const sort = [{ key: "archetype" as const, asc: true }];
  // Alphabetically Gunner < Powerhouse, but the custom order flips them.
  expect(compareRows(gunner, powerhouse, sort)).toBeLessThan(0);
  expect(compareRows(gunner, powerhouse, sort, orders)).toBeGreaterThan(0);
  // Descending reverses the custom order too.
  expect(
    compareRows(gunner, powerhouse, [{ key: "archetype", asc: false }], orders),
  ).toBeLessThan(0);
});

test("custom order puts unlisted values after listed ones, alphabetical among themselves", () => {
  const orders = { archetype: ["Specialist"] };
  const sort = [{ key: "archetype" as const, asc: true }];
  const listed = row({ archetype: "Specialist" });
  const unlistedA = row({ archetype: "Brawler" });
  const unlistedB = row({ archetype: "Gunner" });
  expect(compareRows(listed, unlistedA, sort, orders)).toBeLessThan(0);
  expect(compareRows(unlistedA, unlistedB, sort, orders)).toBeLessThan(0);
});

test("custom order keeps missing values last and ignores other columns", () => {
  const orders = { archetype: ["Powerhouse", "Gunner"] };
  const missing = row({});
  const listed = row({ archetype: "Gunner" });
  expect(
    compareRows(missing, listed, [{ key: "archetype", asc: true }], orders),
  ).toBeGreaterThan(0);
  // A name sort is unaffected by the archetype order.
  const a = row({ name: "Alpha" });
  const b = row({ name: "Beta" });
  expect(
    compareRows(a, b, [{ key: "name", asc: true }], orders),
  ).toBeLessThan(0);
});

test("compareRows walks nest levels until a tie breaks", () => {
  const a = row({ archetype: "Gunner", tertiary: 0, name: "A" }); // weapons
  const b = row({ archetype: "Gunner", tertiary: 3, name: "B" }); // grenade
  const c = row({ archetype: "Powerhouse", tertiary: 0, name: "C" });
  const orders = { archetype: ["Powerhouse", "Gunner"] };
  const sort = [
    { key: "archetype" as const, asc: true },
    { key: "tertiary" as const, asc: true },
  ];
  // Primary: Powerhouse before Gunner.
  expect(compareRows(c, a, sort, orders)).toBeLessThan(0);
  // Same archetype → tertiary (Grenade < Weapons alphabetically).
  expect(compareRows(b, a, sort, orders)).toBeLessThan(0);
  // Empty chain is a no-op tie.
  expect(compareRows(a, b, [])).toBe(0);
});
