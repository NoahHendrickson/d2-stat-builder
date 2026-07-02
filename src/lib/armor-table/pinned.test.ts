import { test, expect } from "vitest";
import { partitionByPin, togglePinned, type FilterOption } from "./pinned";

const options: FilterOption<number>[] = [
  { value: 1, label: "Bushido" },
  { value: 2, label: "Collective Psyche" },
  { value: 3, label: "Last Discipline" },
  { value: 4, label: "Techsec" },
];

test("togglePinned appends new pins and preserves order of the rest", () => {
  expect(togglePinned([], 3)).toEqual([3]);
  expect(togglePinned([3], 1)).toEqual([3, 1]);
  expect(togglePinned([3, 1, 4], 1)).toEqual([3, 4]);
});

test("partitionByPin keeps pin order on top, original order below", () => {
  const { pinned, rest } = partitionByPin(options, [3, 1], "");
  expect(pinned.map((o) => o.value)).toEqual([3, 1]);
  expect(rest.map((o) => o.value)).toEqual([2, 4]);
});

test("partitionByPin ignores pinned values that are not in the options", () => {
  const { pinned, rest } = partitionByPin(options, [99, 2], "");
  expect(pinned.map((o) => o.value)).toEqual([2]);
  expect(rest.map((o) => o.value)).toEqual([1, 3, 4]);
});

test("a search query suppresses the partition and filters labels loosely", () => {
  const { pinned, rest } = partitionByPin(options, [3, 1], "psy");
  expect(pinned).toEqual([]);
  expect(rest.map((o) => o.value)).toEqual([2]);
});

test("blank-ish queries do not suppress the partition", () => {
  const { pinned } = partitionByPin(options, [4], "   ");
  expect(pinned.map((o) => o.value)).toEqual([4]);
});
