import { expect, test } from "vitest";
import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";
import { filterInventoryItems } from "./download";

const POSTMASTER = 215593132;

const def = (
  hash: number,
  itemType: number,
  bucketTypeHash: number,
  name = `Item ${hash}`,
  recoveryBucketTypeHash = 0,
) =>
  ({
    hash,
    itemType,
    displayProperties: { name, icon: "/i.png" },
    inventory: { bucketTypeHash, recoveryBucketTypeHash, tierType: 5 },
  }) as unknown as DestinyInventoryItemDefinition;

test("keeps anything holdable that can land in the postmaster, but not gear previews", () => {
  const all = {
    1: def(1, 25, 2422292810, "Premium Hunter Rewards"), // package
    2: def(2, 0, 2207872501, "Timelost Spirit Bloom"), // seasonal material
    3: def(3, 9, 3703306571, "Keycard (Adamant)"),
    4: def(4, 26, 635141261, "Peaked Pinnacle"), // order
    5: def(5, 0, 2422292810, "Distorted Engram", POSTMASTER), // Tier 1 Engram
    6: def(6, 0, 2422292810, "Twofold Crown Robes"), // gear preview
    7: def(7, 20, 3621873013, "Season Exclusive Armor"), // dummy
    8: { ...def(8, 0, 2207872501), redacted: true },
    9: def(9, 0, 2207872501, ""),
  };
  expect(Object.keys(filterInventoryItems(all, new Set())).map(Number)).toEqual([1, 2, 3, 4, 5]);
});
