import { describe, expect, it } from "vitest";
import { classSets } from "./sets";
import type { ArmorPiece } from "./normalize";
import type { Manifest } from "../manifest/load";

const HELMET_BUCKET = 3448274439;
const WEAPON_BUCKET = 1498876634;

/** A manifest holding just set definitions, their items, and their perks. */
function manifestWith(tables: Record<string, Record<number, unknown>>): Manifest {
  return {
    all: (table: string) => tables[table] ?? {},
    def: (table: string, hash: number) => tables[table]?.[hash],
  } as unknown as Manifest;
}

const perks = [{ requiredSetCount: 2, sandboxPerkHash: 900 }];

describe("classSets", () => {
  it("lists every set the class can wear, owned or not, with owned counts", () => {
    const manifest = manifestWith({
      DestinyEquipableItemSetDefinition: {
        1: { displayProperties: { name: "Owned Set" }, setPerks: perks, setItems: [11] },
        2: { displayProperties: { name: "Unowned Set" }, setPerks: perks, setItems: [12] },
        3: { displayProperties: { name: "Titan Only" }, setPerks: perks, setItems: [13] },
        4: { displayProperties: { name: "No Perks" }, setPerks: [], setItems: [11] },
        5: { displayProperties: { name: "Weapon Set" }, setPerks: perks, setItems: [14] },
      },
      DestinyInventoryItemDefinition: {
        11: { classType: 1, inventory: { bucketTypeHash: HELMET_BUCKET } },
        12: { classType: 1, inventory: { bucketTypeHash: HELMET_BUCKET } },
        13: { classType: 0, inventory: { bucketTypeHash: HELMET_BUCKET } },
        14: { classType: 1, inventory: { bucketTypeHash: WEAPON_BUCKET } },
      },
      DestinySandboxPerkDefinition: { 900: { displayProperties: { name: "Bonus" } } },
    });
    const owned = [{ setHash: 1 }, { setHash: 1 }] as ArmorPiece[];
    const sets = classSets(manifest, 1, owned);
    expect(sets.map((s) => [s.name, s.ownedCount])).toEqual([
      ["Owned Set", 2],
      ["Unowned Set", 0],
    ]);
    expect(sets[1].perks).toEqual([{ requiredCount: 2, name: "Bonus", description: undefined }]);
  });
});
