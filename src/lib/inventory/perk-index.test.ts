import { expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import type { InventoryItem } from "./build";
import { createPerkLookup } from "./perk-index";

const plug = (name: string, category: string) => ({
  displayProperties: { name },
  plug: { plugCategoryIdentifier: category },
});
const items: Record<number, object> = {
  10: plug("Aggressive Frame", "intrinsics"),
  20: plug("Kill Clip", "frames"),
  30: plug("Veist Stinger", "origins"),
  31: plug("Hakke Breach Armaments", "origins"),
};
const manifest = {
  def: (_table: string, hash: number | null | undefined) => (hash == null ? undefined : items[hash]),
} as unknown as Manifest;
const profile = {
  itemComponents: {
    sockets: { data: { w: { sockets: [10, 20, 30].map((plugHash) => ({ plugHash, isVisible: true })) } } },
    reusablePlugs: { data: { w: { plugs: { 2: [{ plugItemHash: 30 }, { plugItemHash: 31 }] } } } },
  },
} as unknown as DestinyProfileResponse;

test("lists a weapon's origin traits among its perks and on their own", () => {
  const lookup = createPerkLookup(profile, manifest);
  const weapon = { instanceId: "w", itemType: 3 } as InventoryItem;
  expect(lookup.perks(weapon)).toEqual([
    "aggressive frame",
    "kill clip",
    "veist stinger",
    "hakke breach armaments",
  ]);
  expect(lookup.origins(weapon)).toEqual(["veist stinger", "hakke breach armaments"]);
});
