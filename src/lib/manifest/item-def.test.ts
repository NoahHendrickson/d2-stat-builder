import { describe, expect, it } from "vitest";
import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";
import { ITEM_DEF_KEYS, projectItemDef, type ItemDef } from "./item-def";

const armor = {
  hash: 111,
  index: 5,
  itemType: 2,
  itemSubType: 26,
  itemCategoryHashes: [20, 45],
  itemTypeDisplayName: "Helmet",
  itemTypeAndTierDisplayName: "Legendary Helmet",
  classType: 1,
  redacted: false,
  flavorText: "flavor",
  isFeaturedItem: true,
  iconWatermark: "/w.png",
  iconWatermarkFeatured: "/wf.png",
  iconWatermarkShelved: "/ws.png",
  displayProperties: { name: "Hood", icon: "/i.png", description: "d", hasIcon: true },
  inventory: { bucketTypeHash: 3448274439, tierType: 5, tierTypeName: "Legendary", stackUniqueLabel: "x" },
  equippingBlock: { equipableItemSetHash: 99, uniqueLabel: "" },
  investmentStats: [
    { statTypeHash: 1, value: 10, isConditionallyActive: false, extra: 1 },
    { statTypeHash: 2, value: 5, isConditionallyActive: true },
  ],
  perks: [{ perkHash: 7, requirementDisplayString: "r" }],
  quality: { currentVersion: 1, displayVersionWatermarkIcons: ["/a", "/b"], versions: [] },
  sockets: {
    detail: "big",
    socketCategories: [{ socketCategoryHash: 1 }],
    intrinsicSockets: [{ plugItemHash: 1 }],
    socketEntries: [
      { socketTypeHash: 10, singleInitialItemHash: 20, reusablePlugItems: [{ plugItemHash: 30 }], defaultVisible: true },
      { socketTypeHash: 11, singleInitialItemHash: 0, reusablePlugSetHash: 40, randomizedPlugSetHash: 41, reusablePlugItems: [] },
    ],
  },
  stats: { statGroupHash: 1, stats: {} },
  translationBlock: { weaponPatternHash: 0 },
  action: { verbName: "Dismantle" },
} as unknown as DestinyInventoryItemDefinition;

describe("projectItemDef", () => {
  it("keeps exactly the fields the app reads and drops the rest", () => {
    const out = projectItemDef(armor);
    expect(out).toEqual({
      hash: 111,
      itemType: 2,
      itemCategoryHashes: [20, 45],
      itemTypeDisplayName: "Helmet",
      classType: 1,
      redacted: false,
      flavorText: "flavor",
      isFeaturedItem: true,
      iconWatermark: "/w.png",
      iconWatermarkFeatured: "/wf.png",
      displayProperties: { name: "Hood", icon: "/i.png", description: "d" },
      inventory: { bucketTypeHash: 3448274439, tierType: 5 },
      equippingBlock: { equipableItemSetHash: 99 },
      investmentStats: [
        { statTypeHash: 1, value: 10, isConditionallyActive: false },
        { statTypeHash: 2, value: 5, isConditionallyActive: true },
      ],
      perks: [{ perkHash: 7 }],
      quality: { currentVersion: 1, displayVersionWatermarkIcons: ["/a", "/b"] },
      sockets: {
        socketEntries: [
          { socketTypeHash: 10, singleInitialItemHash: 20 },
          { socketTypeHash: 11, singleInitialItemHash: 0, reusablePlugSetHash: 40, randomizedPlugSetHash: 41 },
        ],
      },
    } satisfies ItemDef);
  });

  it("keeps every key of ItemDef when the source has them all", () => {
    // A def with every block present: the projection's key set must be exactly the
    // type's key set, so a field added to ItemDef but not to projectItemDef is caught.
    const full = { ...armor, collectibleHash: 42, plug: { plugCategoryIdentifier: "x", insertionMaterialRequirementHash: 0, isDummyPlug: false, insertionRules: [] } } as unknown as DestinyInventoryItemDefinition;
    expect(Object.keys(projectItemDef(full)).sort()).toEqual([...ITEM_DEF_KEYS].sort());
  });

  it("keeps inline socket plug lists only on subclass items", () => {
    const subclass = { ...armor, itemType: 16 } as DestinyInventoryItemDefinition;
    const out = projectItemDef(subclass);
    expect(out.sockets?.socketEntries[0].reusablePlugItems).toEqual([{ plugItemHash: 30 }]);
    expect(out.sockets?.socketEntries[1].reusablePlugItems).toEqual([]);
    expect(projectItemDef(armor).sockets?.socketEntries[0]).not.toHaveProperty("reusablePlugItems");
  });

  it("projects plug blocks and leaves collectibleHash absent when it is absent", () => {
    const mod = {
      hash: 5,
      itemType: 19,
      classType: 3,
      redacted: false,
      displayProperties: { name: "Mod", icon: "", description: "" },
      investmentStats: [],
      perks: [],
      plug: {
        plugCategoryIdentifier: "enhancements.v2_general",
        plugCategoryHash: 1,
        insertionMaterialRequirementHash: 3,
        isDummyPlug: false,
        energyCost: { energyCost: 3, energyTypeHash: 0 },
        insertionRules: [{ failureMessage: "no" }],
        enabledRules: [{ failureMessage: "x" }],
        uiPlugLabel: "",
      },
    } as unknown as DestinyInventoryItemDefinition;
    const out = projectItemDef(mod);
    expect(out.plug).toEqual({
      plugCategoryIdentifier: "enhancements.v2_general",
      insertionMaterialRequirementHash: 3,
      isDummyPlug: false,
      energyCost: { energyCost: 3 },
      insertionRules: [{ failureMessage: "no" }],
    });
    expect(out).not.toHaveProperty("collectibleHash");
    expect(projectItemDef({ ...mod, collectibleHash: 0 } as DestinyInventoryItemDefinition).collectibleHash).toBe(0);
    expect(out).not.toHaveProperty("inventory");
    expect(out).not.toHaveProperty("sockets");
    expect(out).not.toHaveProperty("quality");
  });

  it("tolerates defs missing the always-present blocks", () => {
    const bare = { hash: 1, itemType: 0, classType: 3, redacted: true } as unknown as DestinyInventoryItemDefinition;
    expect(projectItemDef(bare)).toEqual({
      hash: 1,
      itemType: 0,
      classType: 3,
      redacted: true,
      displayProperties: {},
      investmentStats: [],
      perks: [],
    });
  });
});
