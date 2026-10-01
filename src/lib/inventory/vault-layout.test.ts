import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem } from "./build";
import {
  HEADING_HEIGHT_PX,
  layoutVault,
  lineOfItem,
  linesBetween,
  type VaultBucket,
  type VaultTileLine,
} from "./vault-layout";
import type { ItemGroup } from "./view-settings";

const item = (key: string): InventoryItem => ({
  key,
  instanceId: key,
  itemHash: 1,
  name: key,
  typeName: "Auto Rifle",
  itemType: 3,
  classType: 3,
  tierType: 5,
  bucketHash: BUCKETS.kinetic,
  quantity: 1,
  locked: false,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
});

const group = (key: string, count: number): ItemGroup => ({
  key,
  items: Array.from({ length: count }, (_, i) => item(`${key}${i}`)),
});

const bucket = (groups: ItemGroup[], extra: Partial<VaultBucket> = {}): VaultBucket => ({
  key: "kinetic",
  label: "Kinetic",
  groupBy: "type",
  groups,
  stacked: true,
  markerWidth: () => 0,
  ...extra,
});

const tileLines = (buckets: VaultBucket[], width: number) =>
  layoutVault([{ heading: "Weapons", buckets }], width).lines.filter(
    (line): line is VaultTileLine => line.kind === "tiles",
  );

/** Each line as its cells' item counts, e.g. [[5], [3, 2]]. */
const shape = (lines: VaultTileLine[]) => lines.map((line) => line.cells.map((cell) => cell.items.length));

test("an unmeasured pane has no lines", () => {
  expect(layoutVault([{ heading: "Weapons", buckets: [bucket([group("a", 3)])] }], 0)).toEqual({
    lines: [],
    height: 0,
  });
});

test("a group wraps its tiles at the pane's edge", () => {
  // 56px tiles, 6px apart: five fit in 304px (5 * 62 - 6), six need 366.
  expect(shape(tileLines([bucket([group("a", 12)])], 304))).toEqual([[5], [5], [2]]);
  expect(shape(tileLines([bucket([group("a", 12)])], 365))).toEqual([[5], [5], [2]]);
  expect(shape(tileLines([bucket([group("a", 12)])], 366))).toEqual([[6], [6]]);
  // Narrower than a tile: still one per line rather than none.
  expect(shape(tileLines([bucket([group("a", 2)])], 40))).toEqual([[1], [1]]);
});

test("a marker takes its column on every line of the group, and draws on the first", () => {
  // 56px marker + 12px gap leaves 298px of a 366px pane: four tiles.
  const lines = tileLines([bucket([group("a", 6)], { markerWidth: () => 56 })], 366);
  expect(shape(lines)).toEqual([[4], [2]]);
  expect(lines.map((line) => line.cells[0]!.markerWidth)).toEqual([56, 56]);
  expect(lines.map((line) => line.cells[0]!.marker?.key)).toEqual(["a0", undefined]);
});

test("stacked groups get a line each; side by side they share lines that fit them", () => {
  const groups = [group("a", 2), group("b", 2), group("c", 2)];
  expect(shape(tileLines([bucket(groups)], 600))).toEqual([[2], [2], [2]]);

  // Each group is 118px; two and the 20px between them fit in 256, three need 394.
  const sideBySide = (width: number) => shape(tileLines([bucket(groups, { stacked: false, groupBy: "class" })], width));
  expect(sideBySide(394)).toEqual([[2, 2, 2]]);
  expect(sideBySide(393)).toEqual([[2, 2], [2]]);
  expect(sideBySide(256)).toEqual([[2, 2], [2]]);
  expect(sideBySide(255)).toEqual([[2], [2], [2]]);
});

test("a group too wide to share a line takes its own, between the small ones", () => {
  const lines = tileLines(
    [bucket([group("a", 1), group("big", 7), group("c", 1), group("d", 1)], { stacked: false, groupBy: "class" })],
    304,
  );
  expect(shape(lines)).toEqual([[1], [5], [2], [1, 1]]);
  expect(lines.map((line) => line.cells.map((cell) => cell.key))).toEqual([["a"], ["big"], ["big"], ["c", "d"]]);
});

test("lines stack with the bucket's padding and the gaps between and within groups", () => {
  const { lines, height } = layoutVault(
    [
      { heading: "Weapons", buckets: [bucket([group("a", 6), group("b", 1)]), bucket([], { key: "energy" })] },
      { heading: "Armor", buckets: [bucket([group("c", 1)], { key: "helmet" })] },
    ],
    304,
  );
  expect(lines.map((line) => [line.kind, line.top, line.height])).toEqual([
    ["heading", 0, HEADING_HEIGHT_PX],
    // 10px above the bucket's first line, 6px between a group's lines, 16px before
    // the next group, and 10px under the bucket's last line.
    ["tiles", 40, 10 + 72],
    ["tiles", 122, 6 + 72],
    ["tiles", 200, 16 + 72 + 10],
    // The empty bucket takes no space.
    ["heading", 298, HEADING_HEIGHT_PX],
    ["tiles", 338, 10 + 72 + 10],
  ]);
  expect(height).toBe(430);
  expect(lines.map((line) => line.key)).toEqual([
    "heading:Weapons",
    "kinetic:a:0",
    "kinetic:a:1",
    "kinetic:b:0",
    "heading:Armor",
    "helmet:c:0",
  ]);
});

test("every item is laid out exactly once at any width", () => {
  const groups = [group("a", 37), group("b", 1), group("c", 4), group("d", 90), group("e", 2)];
  const all = groups.flatMap((g) => g.items.map((i) => i.key));
  for (const stacked of [true, false]) {
    for (let width = 30; width <= 2400; width += 37) {
      const lines = tileLines([bucket(groups, { stacked, markerWidth: (g) => (g.key === "c" ? 0 : 24) })], width);
      const placed = lines.flatMap((line) => line.cells.flatMap((cell) => cell.items.map((i) => i.key)));
      expect(placed).toEqual(all);
      // Unique line keys, and offsets that run on from one line to the next.
      expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
      lines.forEach((line, i) => i > 0 && expect(line.top).toBe(lines[i - 1]!.top + lines[i - 1]!.height));
    }
  }
});

test("linesBetween finds the lines overlapping a stretch of the list", () => {
  const { lines } = layoutVault([{ heading: "Weapons", buckets: [bucket([group("a", 50)])] }], 304);
  // heading 0–40, then lines at 40 (82 tall), 122, 200, 278, … (78 apart).
  expect(linesBetween(lines, 0, 40)).toEqual([0, 1]);
  expect(linesBetween(lines, 0, 41)).toEqual([0, 2]);
  expect(linesBetween(lines, 122, 200)).toEqual([2, 3]);
  expect(linesBetween(lines, 121, 201)).toEqual([1, 4]);
  expect(linesBetween(lines, -500, -100)).toEqual([0, 0]);
  expect(linesBetween(lines, 1e6, 2e6)).toEqual([lines.length, lines.length]);
  expect(linesBetween(lines, -100, 1e6)).toEqual([0, lines.length]);
});

test("lineOfItem finds the line an item is on", () => {
  const { lines } = layoutVault([{ heading: "Weapons", buckets: [bucket([group("a", 12)])] }], 304);
  expect(lineOfItem(lines, "a0")).toBe(1);
  expect(lineOfItem(lines, "a11")).toBe(3);
  expect(lineOfItem(lines, "missing")).toBe(-1);
});
