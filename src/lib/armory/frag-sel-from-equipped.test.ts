import { test, expect } from "vitest";
import { fragSelFromEquipped } from "./frag-sel-from-equipped";

test("keeps only hashes present in the known set", () => {
  const next = fragSelFromEquipped([1, 2, 3, 2], new Set([2, 3, 9]));
  expect([...next].sort()).toEqual([2, 3]);
});

test("returns an empty set when nothing overlaps", () => {
  expect(fragSelFromEquipped([1, 2], new Set([9])).size).toBe(0);
});
