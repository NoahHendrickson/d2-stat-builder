import { test, expect } from "vitest";
import { dedupeModOptions, isExcludedModName, type ModOption } from "./mod-options";

const opt = (hash: number, name: string, cost: number, artifactOnly = false): ModOption => ({
  hash,
  name,
  cost,
  stackable: true,
  artifactOnly,
});

const siphon3 = opt(1, "Arc Siphon", 3);
const siphon1 = opt(2, "Arc Siphon", 1, true);
const dynamo = opt(3, "Dynamo", 1);

test("dedupeModOptions shows the full-cost copy when insertability is unknown", () => {
  expect(dedupeModOptions([siphon1, siphon3, dynamo]).map((o) => o.hash)).toEqual([3, 1]);
});

test("dedupeModOptions prefers the copy the player can insert", () => {
  expect(dedupeModOptions([siphon3, siphon1, dynamo], new Set([2, 3])).map((o) => o.hash)).toEqual([
    2, 3,
  ]);
  // Neither copy insertable → fall back to the full-cost one rather than hiding the mod.
  expect(dedupeModOptions([siphon3, siphon1], new Set([3])).map((o) => o.hash)).toEqual([1]);
});

test("dedupeModOptions drops exact hash repeats", () => {
  expect(dedupeModOptions([dynamo, dynamo])).toHaveLength(1);
});

test("isExcludedModName hides Curse of Riven leftovers", () => {
  expect(isExcludedModName("Curse of Riven")).toBe(true);
  expect(isExcludedModName("Riven's Curse")).toBe(true);
  expect(isExcludedModName("Arc Siphon")).toBe(false);
});
