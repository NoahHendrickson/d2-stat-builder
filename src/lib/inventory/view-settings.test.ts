import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem } from "./build";
import { DEFAULT_VIEW, groupItems, itemComparator, parseViewSettings } from "./view-settings";

const item = (name: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  key: name,
  instanceId: name,
  itemHash: 1,
  name,
  typeName: "Helmet",
  itemType: 2,
  classType: 3,
  tierType: 5,
  bucketHash: BUCKETS.helmet,
  quantity: 1,
  locked: false,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
  ...extra,
});

test("parseViewSettings drops unknown keys and falls back to defaults", () => {
  expect(parseViewSettings(JSON.stringify({ sort: ["power", "bogus", "power", "tag"], vaultGroup: "type" }))).toEqual({
    sort: ["power", "tag"],
    vaultGroup: "type",
  });
  expect(parseViewSettings(JSON.stringify({ vaultGroup: "nope" }))).toEqual(DEFAULT_VIEW);
  expect(parseViewSettings("{")).toEqual(DEFAULT_VIEW);
});

test("itemComparator follows the chain, then the name", () => {
  const items = [
    item("b", { power: 10 }),
    item("a", { power: 10 }),
    item("c", { power: 20, tierType: 6 }),
    item("d", { power: 30 }),
  ];
  const byPower = [...items].sort(itemComparator(["power"], {}));
  expect(byPower.map((i) => i.name)).toEqual(["d", "c", "a", "b"]);
  const byTag = [...items].sort(itemComparator(["tag", "rarity"], { b: { tag: "favorite" }, d: { tag: "junk" } }));
  expect(byTag.map((i) => i.name)).toEqual(["b", "c", "a", "d"]);
});

test("groupItems splits a row in a fixed order and skips labels for one group", () => {
  const items = [item("w", { classType: 2 }), item("t", { classType: 0 }), item("t2", { classType: 0 })];
  expect(groupItems(items, "class").map((g) => [g.label, g.items.map((i) => i.name)])).toEqual([
    ["Titan", ["t", "t2"]],
    ["Warlock", ["w"]],
  ]);
  expect(groupItems(items.slice(1), "class")).toEqual([{ key: "0", items: items.slice(1) }]);
});
