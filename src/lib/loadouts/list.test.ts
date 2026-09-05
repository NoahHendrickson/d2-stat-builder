import { test, expect } from "vitest";
import { collectHashtags, duplicateName, filterLoadouts, sortSavedLoadouts } from "./list";
import { MAX_NAME_LENGTH, type SavedLoadout } from "./types";

function make(
  name: string,
  opts: { classType?: number; notes?: string; updatedAt?: number; total?: number } = {},
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
      equipped: [],
      unequipped: [],
      parameters: { mods: [], assumeArmorMasterwork: 3 },
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
  expect(filterLoadouts(rows, { query: "", classType: 0 }).map((l) => l.id)).toEqual([
    "Alpha #pve",
    "Charlie",
  ]);
});

test("text query matches name or notes; #query matches hashtags by prefix", () => {
  expect(filterLoadouts(rows, { query: "raid", classType: null }).map((l) => l.id)).toEqual([
    "bravo",
  ]);
  expect(filterLoadouts(rows, { query: "#pv", classType: null }).map((l) => l.id)).toEqual([
    "Alpha #pve",
    "bravo",
  ]);
  expect(filterLoadouts(rows, { query: "#", classType: null })).toHaveLength(3);
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
