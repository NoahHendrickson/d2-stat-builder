import type {
  DestinyDisplayPropertiesDefinition,
  DestinyEnergyCostEntry,
  DestinyEquippingBlockDefinition,
  DestinyInventoryItemDefinition,
  DestinyItemInventoryBlockDefinition,
  DestinyItemInvestmentStatDefinition,
  DestinyItemPerkEntryDefinition,
  DestinyItemPlugDefinition,
  DestinyItemQualityBlockDefinition,
  DestinyItemSocketEntryDefinition,
  DestinyItemSocketEntryPlugItemDefinition,
  DestinyPlugRuleDefinition,
} from "bungie-api-ts/destiny2";

/**
 * The slice of `DestinyInventoryItemDefinition` the app reads. The full item table is
 * ~200 MB of JSON and even the armor/plug subset is 90 MB; this projection is ~22 MB, so
 * it is what gets cached in IndexedDB and deserialized on every load.
 *
 * Adding a field: add it here (the type is what every consumer sees), add it to
 * `projectItemDef`, and bump `CACHE_REVISION` in load.ts so cached tables are rebuilt.
 */
export interface ItemDef
  extends Pick<
      DestinyInventoryItemDefinition,
      | "hash"
      | "itemType"
      | "itemCategoryHashes"
      | "itemTypeDisplayName"
      | "classType"
      | "redacted"
      | "collectibleHash"
      | "flavorText"
      | "isFeaturedItem"
    >,
    // bungie-api-ts declares these required, but the live table omits them on
    // thousands of definitions (a census of the kept table: iconWatermark absent on
    // ~5,100, iconWatermarkFeatured on ~5,500, displayProperties.icon on ~500).
    Partial<Pick<DestinyInventoryItemDefinition, "iconWatermark" | "iconWatermarkFeatured">> {
  readonly displayProperties: Pick<DestinyDisplayPropertiesDefinition, "name" | "description"> &
    Partial<Pick<DestinyDisplayPropertiesDefinition, "icon">>;
  readonly inventory?: Pick<
    DestinyItemInventoryBlockDefinition,
    "bucketTypeHash" | "tierType"
  >;
  readonly equippingBlock?: Pick<
    DestinyEquippingBlockDefinition,
    "equipableItemSetHash"
  >;
  readonly investmentStats: Pick<
    DestinyItemInvestmentStatDefinition,
    "statTypeHash" | "value" | "isConditionallyActive"
  >[];
  readonly perks: Pick<DestinyItemPerkEntryDefinition, "perkHash">[];
  readonly plug?: ItemDefPlug;
  readonly sockets?: { readonly socketEntries: ItemDefSocketEntry[] };
  readonly quality?: Pick<
    DestinyItemQualityBlockDefinition,
    "currentVersion" | "displayVersionWatermarkIcons"
  >;
}

export interface ItemDefPlug
  extends Pick<
    DestinyItemPlugDefinition,
    "plugCategoryIdentifier" | "insertionMaterialRequirementHash" | "isDummyPlug"
  > {
  readonly energyCost?: Pick<DestinyEnergyCostEntry, "energyCost">;
  readonly insertionRules: Pick<DestinyPlugRuleDefinition, "failureMessage">[];
}

export interface ItemDefSocketEntry
  extends Pick<
    DestinyItemSocketEntryDefinition,
    | "socketTypeHash"
    | "singleInitialItemHash"
    | "reusablePlugSetHash"
    | "randomizedPlugSetHash"
  > {
  /**
   * Inline plug list. Kept only on subclass items — the ability/aspect/fragment socket
   * lookups are the sole readers, and armor's copies are 12 MB of the unprojected table.
   */
  readonly reusablePlugItems?: Pick<
    DestinyItemSocketEntryPlugItemDefinition,
    "plugItemHash"
  >[];
}

/** DestinyItemType.Subclass */
const ITEM_TYPE_SUBCLASS = 16;

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Copy `keys` from `src` onto a fresh object, omitting keys that are `undefined`. */
function pick<T extends object, K extends keyof T>(
  src: T,
  keys: readonly K[],
): Writable<Pick<T, K>> {
  const out = {} as Writable<Pick<T, K>>;
  for (const key of keys) {
    const value = src[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The nested blocks, projected field by field below. */
const BLOCK_KEYS = [
  "displayProperties",
  "inventory",
  "equippingBlock",
  "investmentStats",
  "perks",
  "plug",
  "sockets",
  "quality",
] as const satisfies readonly (keyof ItemDef)[];
type BlockKey = (typeof BLOCK_KEYS)[number];
/** Top-level scalars/arrays copied as-is. */
const TOP_KEYS = [
  "hash",
  "itemType",
  "itemCategoryHashes",
  "itemTypeDisplayName",
  "classType",
  "redacted",
  "collectibleHash",
  "flavorText",
  "isFeaturedItem",
  "iconWatermark",
  "iconWatermarkFeatured",
] as const satisfies readonly Exclude<keyof ItemDef, BlockKey>[];
// Compile-time completeness: a key added to ItemDef must be listed in one of the two
// (otherwise projectItemDef would silently drop it). A missing key makes this line
// fail to type-check.
type UnlistedKey = Exclude<keyof ItemDef, (typeof TOP_KEYS)[number] | BlockKey>;
const _everyItemDefKeyIsListed: [UnlistedKey] extends [never] ? true : never = true;
void _everyItemDefKeyIsListed;

/** Every key of `ItemDef`, for tests that check a projection keeps all of them. */
export const ITEM_DEF_KEYS: readonly (keyof ItemDef)[] = [...TOP_KEYS, ...BLOCK_KEYS];

/**
 * Reduce a full item definition to the fields in `ItemDef`. Array positions are preserved
 * (socket entries are indexed by live socket index; watermark icons by version number).
 * `collectibleHash` stays absent when absent — its presence marks a mod as non-artifact.
 */
export function projectItemDef(def: DestinyInventoryItemDefinition): ItemDef {
  const out: Writable<ItemDef> = {
    ...pick(def, TOP_KEYS),
    displayProperties: pick(def.displayProperties ?? {}, [
      "name",
      "icon",
      "description",
    ]) as ItemDef["displayProperties"],
    investmentStats: (def.investmentStats ?? []).map((s) =>
      pick(s, ["statTypeHash", "value", "isConditionallyActive"]),
    ),
    perks: (def.perks ?? []).map((p) => pick(p, ["perkHash"])),
  };
  if (def.inventory) {
    out.inventory = pick(def.inventory, ["bucketTypeHash", "tierType"]);
  }
  if (def.equippingBlock) {
    out.equippingBlock = pick(def.equippingBlock, ["equipableItemSetHash"]);
  }
  if (def.plug) {
    const plug: Writable<ItemDefPlug> = {
      ...pick(def.plug, [
        "plugCategoryIdentifier",
        "insertionMaterialRequirementHash",
        "isDummyPlug",
      ]),
      insertionRules: (def.plug.insertionRules ?? []).map((r) =>
        pick(r, ["failureMessage"]),
      ),
    };
    if (def.plug.energyCost) {
      plug.energyCost = pick(def.plug.energyCost, ["energyCost"]);
    }
    out.plug = plug;
  }
  if (def.sockets?.socketEntries) {
    const keepPlugItems = def.itemType === ITEM_TYPE_SUBCLASS;
    out.sockets = {
      socketEntries: def.sockets.socketEntries.map((e) => {
        const entry: Writable<ItemDefSocketEntry> = pick(e, [
          "socketTypeHash",
          "singleInitialItemHash",
          "reusablePlugSetHash",
          "randomizedPlugSetHash",
        ]);
        if (keepPlugItems && e.reusablePlugItems) {
          entry.reusablePlugItems = e.reusablePlugItems.map((p) =>
            pick(p, ["plugItemHash"]),
          );
        }
        return entry;
      }),
    };
  }
  if (def.quality) {
    out.quality = pick(def.quality, [
      "currentVersion",
      "displayVersionWatermarkIcons",
    ]);
  }
  return out;
}
