import { describe, expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "../manifest/load";
import { normalizeWeapons, WEAPON_SLOT_BUCKETS } from "./weapons";

const manifest = {
  def: () => ({
    displayProperties: { name: "Gun" },
    inventory: { bucketTypeHash: WEAPON_SLOT_BUCKETS.kinetic },
  }),
} as unknown as Manifest;

const profile = (state: number, gearTier?: number) =>
  ({
    profileInventory: {
      data: { items: [{ itemInstanceId: "1", itemHash: 10, state, bucketHash: 138197802 }] },
    },
    itemComponents: { instances: { data: { 1: { gearTier, primaryStat: { value: 550 } } } } },
  }) as unknown as DestinyProfileResponse;

describe("normalizeWeapons", () => {
  test("reads masterwork from the item's state and keeps its tier", () => {
    const [weapon] = normalizeWeapons(profile(4, 3), manifest);
    expect(weapon).toMatchObject({ masterworked: true, gearTier: 3, power: 550 });
  });

  test("a weapon that isn't masterworked says nothing, and a bogus tier is dropped", () => {
    const [weapon] = normalizeWeapons(profile(1, 0), manifest);
    expect(weapon.masterworked).toBeUndefined();
    expect(weapon.gearTier).toBeUndefined();
    expect(weapon.locked).toBe(true);
  });
});
