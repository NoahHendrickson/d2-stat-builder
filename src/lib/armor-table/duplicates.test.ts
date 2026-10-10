import { test, expect } from "vitest";
import { duplicateKey, duplicateMatchSummary, groupDuplicates, type DuplicateRow } from "./duplicates";

type TestRow = DuplicateRow & { id: string };

const row = (id: string, over: Partial<DuplicateRow["piece"]> = {}, tertiary: number | null = 3): TestRow => ({
  id,
  piece: {
    classType: 2,
    slot: "helmet",
    itemHash: 100,
    isExotic: false,
    setHash: 7,
    archetype: "Brawler",
    baseStats: [10, 30, 5, 20, 5, 25],
    tunedStat: 0,
    ...over,
  },
  tertiary: tertiary ?? undefined,
});

test("matching set, slot, archetype, tertiary and tuning are duplicates", () => {
  expect(duplicateKey(row("a"))).toBe(duplicateKey(row("b", { itemHash: 101 })));
});

test("any differing field splits pieces apart", () => {
  const base = duplicateKey(row("a"));
  expect(duplicateKey(row("b", { classType: 1 }))).not.toBe(base);
  expect(duplicateKey(row("b", { slot: "arms" }))).not.toBe(base);
  expect(duplicateKey(row("b", { setHash: 8 }))).not.toBe(base);
  expect(duplicateKey(row("b", { archetype: "Gunner" }))).not.toBe(base);
  expect(duplicateKey(row("b", { tunedStat: 4 }))).not.toBe(base);
  expect(duplicateKey(row("b", {}, 2))).not.toBe(base);
});

test("match can leave out the tuning, the tertiary, or both", () => {
  const a = row("a");
  const otherTuning = row("b", { tunedStat: 4 });
  const otherTertiary = row("c", {}, 2);
  const noTuning = { tuning: false, tertiary: true };
  const noTertiary = { tuning: true, tertiary: false };
  const loose = { tuning: false, tertiary: false };
  expect(duplicateKey(a, noTuning)).toBe(duplicateKey(otherTuning, noTuning));
  expect(duplicateKey(a, noTuning)).not.toBe(duplicateKey(otherTertiary, noTuning));
  expect(duplicateKey(a, noTertiary)).toBe(duplicateKey(otherTertiary, noTertiary));
  expect(duplicateKey(a, noTertiary)).not.toBe(duplicateKey(otherTuning, noTertiary));
  expect(duplicateKey(otherTuning, loose)).toBe(duplicateKey(otherTertiary, loose));
  expect(duplicateKey(row("d", { archetype: "Gunner" }), loose)).not.toBe(duplicateKey(a, loose));
});

test("duplicateMatchSummary lists what has to match", () => {
  expect(duplicateMatchSummary({ tuning: true, tertiary: true })).toBe(
    "set, slot, archetype, tertiary, and tuning",
  );
  expect(duplicateMatchSummary({ tuning: false, tertiary: true })).toBe("set, slot, archetype, and tertiary");
  expect(duplicateMatchSummary({ tuning: false, tertiary: false })).toBe("set, slot, and archetype");
});

test("legacy pieces never match", () => {
  expect(duplicateKey(row("a", {}, null))).toBeUndefined();
});

test("an unresolved archetype compares the roll's two highest stats", () => {
  const unresolved = (id: string, baseStats: number[]) =>
    row(id, { archetype: undefined, baseStats: baseStats as DuplicateRow["piece"]["baseStats"] });
  expect(duplicateKey(unresolved("a", [10, 30, 5, 20, 5, 25]))).toBe(
    duplicateKey(unresolved("b", [5, 28, 10, 18, 2, 22])),
  );
  expect(duplicateKey(unresolved("a", [10, 30, 5, 20, 5, 25]))).not.toBe(
    duplicateKey(unresolved("b", [10, 25, 5, 20, 5, 30])),
  );
});

test("exotics match by item, and class items by their perk pair", () => {
  const ex = (id: string, itemHash: number, perks?: [number, number]) =>
    row(id, { isExotic: true, setHash: undefined, itemHash, exoticPerkHashes: perks });
  expect(duplicateKey(ex("a", 5))).toBe(duplicateKey(ex("b", 5)));
  expect(duplicateKey(ex("a", 5))).not.toBe(duplicateKey(ex("b", 6)));
  expect(duplicateKey(ex("a", 5, [1, 2]))).not.toBe(duplicateKey(ex("b", 5, [1, 3])));
});

test("groupDuplicates drops singletons and keeps groups contiguous in input order", () => {
  const rows = [
    row("a1"),
    row("solo", { slot: "chest" }),
    row("b1", { tunedStat: 4 }),
    row("a2"),
    row("b2", { tunedStat: 4 }),
    row("a3"),
  ];
  const out = groupDuplicates(rows);
  expect(out.rows.map((r) => r.id)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  expect(out.groups).toEqual([
    { index: 0, first: true },
    { index: 0, first: false },
    { index: 0, first: false },
    { index: 1, first: true },
    { index: 1, first: false },
  ]);
  expect(out.groupCount).toBe(2);
});
