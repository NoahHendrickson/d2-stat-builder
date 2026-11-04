import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import { ITEMS_LAYOUT_INTRO_KEY, VIEW_SETTINGS_KEY, settleItemsLayout } from "./items-layout-default";
import type { InventoryItem } from "./build";
import {
  DEFAULT_VIEW,
  groupItems,
  itemComparator,
  parseViewSettings,
  resetSortAndGrouping,
} from "./view-settings";

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
  expect(
    parseViewSettings(
      JSON.stringify({
        sort: ["power", "bogus", "power", "tag"],
        weaponGroup: "ammo",
        armorGroup: "rarity",
        vaultTab: "armor",
        layout: "legacy",
        characterColumns: "current",
        tileSize: "small",
      }),
    ),
  ).toEqual({
    sort: ["power", "tag"],
    weaponGroup: "ammo",
    armorGroup: "rarity",
    vaultTab: "armor",
    layout: "legacy",
    characterColumns: "current",
    tileSize: "small",
  });
  // Saved views without a layout predate the legacy default: they keep character rows.
  const savedDefaults = { ...DEFAULT_VIEW, layout: "rows" };
  // The old single setting carries over to armor; weapons take their default.
  expect(parseViewSettings(JSON.stringify({ vaultGroup: "tier" }))).toEqual({ ...savedDefaults, armorGroup: "tier" });
  expect(
    parseViewSettings(JSON.stringify({ weaponGroup: "nope", vaultGroup: "nope", vaultTab: "nope", layout: "nope", characterColumns: 3, tileSize: 50 })),
  ).toEqual(savedDefaults);
  expect(parseViewSettings("{")).toEqual(savedDefaults);
  // Groupings that don't apply to the kind (weapons by class, armor by ammo) fall back.
  expect(parseViewSettings(JSON.stringify({ weaponGroup: "class", armorGroup: "ammo" }))).toEqual(savedDefaults);
  expect(parseViewSettings(JSON.stringify({ armorGroup: "type" }))).toEqual(savedDefaults);
  // Nothing saved: the defaults, legacy columns.
  expect(parseViewSettings(null)).toEqual(DEFAULT_VIEW);
  expect(DEFAULT_VIEW.layout).toBe("legacy");
});

/** A Storage over a Map, enough for settleItemsLayout. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

test("settleItemsLayout: a new browser gets legacy columns, a returning one keeps character rows", () => {
  const fresh = memoryStorage();
  settleItemsLayout(fresh);
  expect(parseViewSettings(fresh.getItem(VIEW_SETTINGS_KEY))).toEqual(DEFAULT_VIEW);
  // The note on character rows is for people moved off the old layout.
  expect(fresh.getItem(ITEMS_LAYOUT_INTRO_KEY)).toBe("1");
  // Decided once: keys saved later don't make it a returning browser.
  fresh.setItem("stat-builder:selections", "{}");
  settleItemsLayout(fresh);
  expect(parseViewSettings(fresh.getItem(VIEW_SETTINGS_KEY)).layout).toBe("legacy");

  const returning = memoryStorage({ "stat-builder:changelog-seen": "x" });
  settleItemsLayout(returning);
  expect(parseViewSettings(returning.getItem(VIEW_SETTINGS_KEY))).toEqual({ ...DEFAULT_VIEW, layout: "rows" });
  expect(returning.getItem(ITEMS_LAYOUT_INTRO_KEY)).toBeNull();

  // Saved settings, either layout, are left alone.
  for (const layout of ["rows", "legacy"]) {
    const saved = JSON.stringify({ layout, tileSize: "small" });
    const storage = memoryStorage({ [VIEW_SETTINGS_KEY]: saved });
    settleItemsLayout(storage);
    expect(storage.getItem(VIEW_SETTINGS_KEY)).toBe(saved);
  }
  // Other sites' keys on the same origin don't count.
  const other = memoryStorage({ "something-else": "1" });
  settleItemsLayout(other);
  expect(parseViewSettings(other.getItem(VIEW_SETTINGS_KEY)).layout).toBe("legacy");
});

test("resetSortAndGrouping resets only the sort and grouping", () => {
  const view = {
    sort: ["tag" as const],
    weaponGroup: "ammo" as const,
    armorGroup: "rarity" as const,
    vaultTab: "armor" as const,
    layout: "legacy" as const,
    characterColumns: "current" as const,
    tileSize: "medium" as const,
  };
  expect(resetSortAndGrouping(view)).toEqual({
    sort: DEFAULT_VIEW.sort,
    weaponGroup: DEFAULT_VIEW.weaponGroup,
    armorGroup: DEFAULT_VIEW.armorGroup,
    vaultTab: "armor",
    layout: "legacy",
    characterColumns: "current",
    tileSize: "medium",
  });
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
