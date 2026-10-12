import { expect, test } from "vitest";
import type { ArmorSlot } from "../armory/stats";
import type { UsageBucket } from "../build-usage/buckets";
import { groupCleanup, type CleanupRow } from "./cleanup";

type Row = CleanupRow & { id: string };
const row = (
  id: string,
  classType: number,
  slot: ArmorSlot,
  usageBucket: UsageBucket,
  used = 0,
  eligible = 40,
): Row => ({ id, piece: { classType, slot }, usage: { used, eligible }, usageBucket });

test("keeps only the chosen tiers, grouped by class then slot, least used first", () => {
  const out = groupCleanup(
    [
      row("w-legs-rare", 2, "legs", "rarely", 2),
      row("h-helm-often", 1, "helmet", "often", 30),
      row("w-helm-rare", 2, "helmet", "rarely", 3),
      row("w-helm-never", 2, "helmet", "never", 0, 25),
      row("w-helm-never-sure", 2, "helmet", "never", 0, 60),
      row("t-chest-some", 0, "chest", "sometimes", 8),
      row("unrated", 0, "chest", "unknown", 0, 3),
    ],
    ["never", "rarely"],
  );
  expect(out.rows.map((r) => r.id)).toEqual([
    "w-helm-never-sure", // never, seen in the most searches
    "w-helm-never",
    "w-helm-rare",
    "w-legs-rare",
  ]);
  expect(out.groupCount).toBe(2);
  expect(out.groups.map((g) => g.first)).toEqual([true, false, false, true]);
});

test("sometimes is opt-in", () => {
  const rows = [row("t-chest-some", 0, "chest", "sometimes", 8)];
  expect(groupCleanup(rows, ["never", "rarely"]).rows).toHaveLength(0);
  expect(groupCleanup(rows, ["sometimes"]).rows).toHaveLength(1);
});
