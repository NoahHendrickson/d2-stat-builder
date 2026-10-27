import { test, expect } from "vitest";
import {
  activeSortMode,
  applyCustomOrder,
  applySortAction,
  clearSortLevel,
  compareRows,
  isStatSortKey,
  moveOrderItem,
  promoteSortLevel,
  preferredAsc,
  reorderCustomLevel,
  soloSortLevel,
  sortKeyLabel,
  sortModeLabel,
  sortModesFor,
  sortValue,
  type SortableRow,
} from "./sort";

const row = (over: {
  name?: string;
  stats?: number[];
  archetype?: string;
  tertiary?: number;
  setName?: string;
}): SortableRow => ({
  piece: {
    name: over.name ?? "Test Piece",
    classType: 1,
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
    compareRows(lo, hi, [{ key: "stat-weapons", kind: "dir", asc: true }]),
  ).toBeLessThan(0);
  expect(
    compareRows(lo, hi, [{ key: "stat-weapons", kind: "dir", asc: false }]),
  ).toBeGreaterThan(0);
});

test("compareRows puts missing values last in both directions", () => {
  const has = row({ archetype: "Gunner" });
  const missing = row({});
  expect(
    compareRows(missing, has, [{ key: "archetype", kind: "dir", asc: true }]),
  ).toBeGreaterThan(0);
  expect(
    compareRows(missing, has, [{ key: "archetype", kind: "dir", asc: false }]),
  ).toBeGreaterThan(0);
  expect(
    compareRows(missing, missing, [
      { key: "archetype", kind: "dir", asc: true },
    ]),
  ).toBe(0);
});

test("compareRows sorts tertiary by stat label", () => {
  const weapons = row({ tertiary: 0 });
  const grenade = row({ tertiary: 3 });
  expect(
    compareRows(grenade, weapons, [
      { key: "tertiary", kind: "dir", asc: true },
    ]),
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

test("activeSortMode reads kind from the level itself", () => {
  expect(activeSortMode([], "name")).toBeNull();
  expect(
    activeSortMode([{ key: "name", kind: "dir", asc: true }], "name"),
  ).toBe("asc");
  expect(
    activeSortMode([{ key: "name", kind: "dir", asc: false }], "name"),
  ).toBe("desc");
  expect(
    activeSortMode([{ key: "name", kind: "dir", asc: true }], "class"),
  ).toBeNull();
  expect(
    activeSortMode(
      [{ key: "archetype", kind: "custom", order: ["Powerhouse", "Gunner"] }],
      "archetype",
    ),
  ).toBe("custom");
});

test("applySortAction replaces, nests, or updates in place atomically", () => {
  expect(applySortAction([], "name", { mode: "asc" })).toEqual({
    sort: [{ key: "name", kind: "dir", asc: true }],
  });
  expect(
    applySortAction(
      [{ key: "name", kind: "dir", asc: true }],
      "archetype",
      { mode: "desc" },
    ),
  ).toEqual({
    sort: [{ key: "archetype", kind: "dir", asc: false }],
    discardedChain: [{ key: "name", kind: "dir", asc: true }],
  });
  expect(
    applySortAction(
      [{ key: "name", kind: "dir", asc: true }],
      "archetype",
      { mode: "asc" },
      true,
    ),
  ).toEqual({
    sort: [
      { key: "name", kind: "dir", asc: true },
      { key: "archetype", kind: "dir", asc: true },
    ],
  });
  expect(
    applySortAction(
      [
        { key: "name", kind: "dir", asc: true },
        { key: "archetype", kind: "dir", asc: true },
      ],
      "archetype",
      { mode: "custom", order: ["Powerhouse", "Gunner"] },
      true,
    ),
  ).toEqual({
    sort: [
      { key: "name", kind: "dir", asc: true },
      {
        key: "archetype",
        kind: "custom",
        order: ["Powerhouse", "Gunner"],
      },
    ],
  });
});

test("clearSortLevel drops one column and snapshots the prior chain", () => {
  const chain = [
    { key: "archetype" as const, kind: "dir" as const, asc: true },
    { key: "tertiary" as const, kind: "dir" as const, asc: true },
    { key: "name" as const, kind: "dir" as const, asc: true },
  ];
  expect(clearSortLevel(chain, "tertiary")).toEqual({
    sort: [
      { key: "archetype", kind: "dir", asc: true },
      { key: "name", kind: "dir", asc: true },
    ],
    discardedChain: chain,
  });
});

test("moveOrderItem reorders by moving from → to", () => {
  expect(moveOrderItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  expect(moveOrderItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  expect(moveOrderItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
});

test("reorderCustomLevel updates only that custom level", () => {
  const sort = [
    { key: "archetype" as const, kind: "custom" as const, order: ["a", "b", "c"] },
    { key: "name" as const, kind: "dir" as const, asc: true },
  ];
  expect(reorderCustomLevel(sort, "archetype", ["a", "b", "c"], 0, 2)).toEqual([
    { key: "archetype", kind: "custom", order: ["b", "c", "a"] },
    { key: "name", kind: "dir", asc: true },
  ]);
});

test("reorderCustomLevel moves the value shown at that place, not the saved order's", () => {
  // "Gone" is no longer owned and "D" is new: the menu shows A, B, C, D.
  const sort = [
    { key: "set" as const, kind: "custom" as const, order: ["A", "Gone", "B", "C"] },
  ];
  const shown = applyCustomOrder(["A", "B", "C", "D"], sort[0].order);
  expect(shown).toEqual(["A", "B", "C", "D"]);
  expect(reorderCustomLevel(sort, "set", shown, 2, 0)).toEqual([
    { key: "set", kind: "custom", order: ["C", "A", "B", "D"] },
  ]);
  expect(reorderCustomLevel(sort, "set", shown, 3, 0)).toEqual([
    { key: "set", kind: "custom", order: ["D", "A", "B", "C"] },
  ]);
});

test("compareRows follows a custom value order on the level", () => {
  const gunner = row({ archetype: "Gunner" });
  const powerhouse = row({ archetype: "Powerhouse" });
  const sort = [
    {
      key: "archetype" as const,
      kind: "custom" as const,
      order: ["Powerhouse", "Gunner"],
    },
  ];
  expect(
    compareRows(gunner, powerhouse, [
      { key: "archetype", kind: "dir", asc: true },
    ]),
  ).toBeLessThan(0);
  expect(compareRows(gunner, powerhouse, sort)).toBeGreaterThan(0);
});

test("compareRows walks nest levels until a tie breaks", () => {
  const a = row({ archetype: "Gunner", tertiary: 0, name: "A" });
  const b = row({ archetype: "Gunner", tertiary: 3, name: "B" });
  const c = row({ archetype: "Powerhouse", tertiary: 0, name: "C" });
  const sort = [
    {
      key: "archetype" as const,
      kind: "custom" as const,
      order: ["Powerhouse", "Gunner"],
    },
    { key: "tertiary" as const, kind: "dir" as const, asc: true },
  ];
  expect(compareRows(c, a, sort)).toBeLessThan(0);
  expect(compareRows(b, a, sort)).toBeLessThan(0);
  expect(compareRows(a, b, [])).toBe(0);
});

test("sortKeyLabel reads header labels, stats included", () => {
  expect(sortKeyLabel("set")).toBe("Set bonus");
  expect(sortKeyLabel("stat-class")).toBe("Class");
  expect(sortKeyLabel("builds")).toBe("Searches");
});

test("sortModesFor puts the natural direction first and custom last", () => {
  expect(sortModesFor("name")).toEqual(["asc", "desc"]);
  expect(sortModesFor("stat-health")).toEqual(["desc", "asc"]);
  expect(sortModesFor("archetype")).toEqual(["asc", "desc", "custom"]);
  expect(sortModeLabel("stat-health", "desc")).toBe("High→Low");
  expect(sortModeLabel("name", "desc")).toBe("Z→A");
});

const chain = [
  { key: "class" as const, kind: "dir" as const, asc: true },
  { key: "archetype" as const, kind: "dir" as const, asc: true },
  { key: "stat-health" as const, kind: "dir" as const, asc: false },
];

test("promoteSortLevel moves a level first and snapshots the chain for undo", () => {
  expect(promoteSortLevel(chain, "stat-health")).toEqual({
    sort: [chain[2], chain[0], chain[1]],
    discardedChain: chain,
  });
  expect(promoteSortLevel(chain, "class")).toEqual({ sort: chain });
  expect(promoteSortLevel(chain, "name")).toEqual({ sort: chain });
});

test("soloSortLevel keeps one level and snapshots the chain for undo", () => {
  expect(soloSortLevel(chain, "archetype")).toEqual({
    sort: [chain[1]],
    discardedChain: chain,
  });
  expect(soloSortLevel([chain[0]], "class")).toEqual({ sort: [chain[0]] });
  expect(soloSortLevel(chain, "name")).toEqual({ sort: chain });
});
