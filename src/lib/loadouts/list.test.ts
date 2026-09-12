import { test, expect } from "vitest";
import {
  collectHashtags,
  collectSetBonusHashes,
  duplicateName,
  filterLoadouts,
  sortSavedLoadouts,
} from "./list";
import { MAX_NAME_LENGTH, type SavedLoadout } from "./types";

function make(
  name: string,
  opts: {
    classType?: number;
    notes?: string;
    updatedAt?: number;
    total?: number;
    setBonuses?: Record<number, number>;
    subclassHash?: number;
  } = {},
): SavedLoadout {
  return {
    id: name,
    version: 1,
    createdAt: 0,
    updatedAt: opts.updatedAt ?? 0,
    loadout: {
      id: "x",
      name,
      notes: opts.notes,
      classType: opts.classType ?? 1,
      equipped: opts.subclassHash !== undefined ? [{ hash: opts.subclassHash }] : [],
      unequipped: [],
      parameters: {
        mods: [],
        assumeArmorMasterwork: 3,
        ...(opts.setBonuses ? { setBonuses: opts.setBonuses } : {}),
      },
    },
    optimizer:
      opts.total === undefined
        ? undefined
        : ({ total: opts.total } as unknown as SavedLoadout["optimizer"]),
  };
}

const rows = [
  make("Alpha #pve", { classType: 0, updatedAt: 3, total: 400 }),
  make("bravo", { classType: 1, notes: "#raid #PvE", updatedAt: 1, total: 500 }),
  make("Charlie", { classType: 3, updatedAt: 2 }),
];

test("filter by class keeps any-class loadouts", () => {
  expect(filterLoadouts(rows, { query: "", classTypes: [0] }).map((l) => l.id)).toEqual([
    "Alpha #pve",
    "Charlie",
  ]);
});

test("class / subclass / set filters are OR within a category", () => {
  expect(
    filterLoadouts(rows, { query: "", classTypes: [0, 1] }).map((l) => l.id),
  ).toEqual(["Alpha #pve", "bravo", "Charlie"]);
  const voidTitan = make("Void", { subclassHash: 2842471112 });
  const solarHunter = make("Solar", { subclassHash: 2240888816 });
  expect(
    filterLoadouts([voidTitan, solarHunter, make("None")], {
      query: "",
      subclasses: ["Void", "Solar"],
    }).map((l) => l.id),
  ).toEqual(["Void", "Solar"]);
  expect(
    filterLoadouts(
      [
        make("Aion", { setBonuses: { 42: 2 } }),
        make("Other", { setBonuses: { 99: 4 } }),
        make("None"),
      ],
      { query: "", setHashes: [42, 99] },
    ).map((l) => l.id),
  ).toEqual(["Aion", "Other"]);
});

test("text query matches name or notes; #query matches hashtags by prefix", () => {
  expect(filterLoadouts(rows, { query: "raid" }).map((l) => l.id)).toEqual([
    "bravo",
  ]);
  expect(filterLoadouts(rows, { query: "#pv" }).map((l) => l.id)).toEqual([
    "Alpha #pve",
    "bravo",
  ]);
  expect(filterLoadouts(rows, { query: "#" })).toHaveLength(3);
});

test("filter by subclass matches the equipped subclass item", () => {
  // Sentinel (Void Titan) / Gunslinger (Solar Hunter) from SUBCLASS_ITEM_HASHES.
  const voidTitan = make("Void", { subclassHash: 2842471112 });
  const solarHunter = make("Solar", { subclassHash: 2240888816 });
  const none = make("None");
  const all = [voidTitan, solarHunter, none];
  expect(
    filterLoadouts(all, { query: "", subclasses: ["Void"] }).map((l) => l.id),
  ).toEqual(["Void"]);
  expect(
    filterLoadouts(all, { query: "", subclasses: ["Solar"] }).map((l) => l.id),
  ).toEqual(["Solar"]);
  expect(
    filterLoadouts(all, { query: "", subclasses: ["Prismatic"] }),
  ).toEqual([]);
});

test("filter by set bonus hash matches any piece count of that set", () => {
  const aion = make("Aion", { setBonuses: { 42: 2 } });
  const other = make("Other", { setBonuses: { 99: 4 } });
  const none = make("None");
  const all = [aion, other, none];
  expect(
    filterLoadouts(all, { query: "", setHashes: [42] }).map((l) => l.id),
  ).toEqual(["Aion"]);
  expect(
    filterLoadouts(all, { query: "", setHashes: [7] }),
  ).toEqual([]);
});

test("collectSetBonusHashes returns unique hashes", () => {
  expect(
    collectSetBonusHashes([
      make("a", { setBonuses: { 42: 2, 7: 4 } }),
      make("b", { setBonuses: { 42: 4 } }),
      make("c"),
    ]),
  ).toEqual([7, 42]);
});

test("text query matches set bonus names", () => {
  const withSet = make("No mention", { setBonuses: { 42: 2 } });
  const setName = (hash: number) => (hash === 42 ? "Aion Renewal" : undefined);
  expect(
    filterLoadouts([withSet, ...rows], { query: "aion", setName }).map(
      (l) => l.id,
    ),
  ).toEqual(["No mention"]);
  expect(filterLoadouts([withSet], { query: "aion" })).toEqual([]);
});

test("sorts by edited, name (case-insensitive), and total (missing last)", () => {
  expect(sortSavedLoadouts(rows, "edited").map((l) => l.id)).toEqual([
    "Alpha #pve",
    "Charlie",
    "bravo",
  ]);
  expect(sortSavedLoadouts(rows, "name").map((l) => l.id)).toEqual([
    "Alpha #pve",
    "bravo",
    "Charlie",
  ]);
  expect(sortSavedLoadouts(rows, "total").map((l) => l.id)).toEqual([
    "bravo",
    "Alpha #pve",
    "Charlie",
  ]);
});

test("collectHashtags orders by frequency then name", () => {
  expect(collectHashtags(rows)).toEqual(["pve", "raid"]);
});

test("duplicateName avoids collisions", () => {
  expect(duplicateName("Build", [])).toBe("Build (copy)");
  expect(duplicateName("Build", ["build (copy)"])).toBe("Build (copy 2)");
  expect(duplicateName("Build", ["Build (copy)", "Build (copy 2)"])).toBe("Build (copy 3)");
});

test("duplicateName never exceeds the name length cap", () => {
  const long = "x".repeat(MAX_NAME_LENGTH);
  const first = duplicateName(long, []);
  expect(first.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  expect(first.endsWith(" (copy)")).toBe(true);
  const second = duplicateName(long, [first]);
  expect(second.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  expect(second.endsWith(" (copy 2)")).toBe(true);
  expect(second).not.toBe(first);
});
