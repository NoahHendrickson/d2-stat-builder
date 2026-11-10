import { describe, expect, test } from "vitest";
import type { ArmorPiece } from "../armory/normalize";
import type { LoadoutWeapon } from "../armory/weapons";
import type { SubclassItem } from "../armory/equipped-subclass";
import { equippedGearName, equippedGearSlot } from "./equipped-gear";

const piece = (instanceId: string, location: ArmorPiece["location"], characterId?: string) =>
  ({ instanceId, itemHash: 100, location, characterId }) as ArmorPiece;
const weapon = (instanceId: string, location: LoadoutWeapon["location"], characterId?: string) =>
  ({ instanceId, itemHash: 200, location, characterId }) as LoadoutWeapon;
const subclass = (instanceId: string, equipped: boolean): SubclassItem => ({
  itemHash: 300,
  instanceId,
  subclass: "Arc",
  equipped,
  abilitySockets: { 0: 1 },
  aspectSockets: { 5: 2 },
  fragmentSockets: { 7: 3 },
});

describe("equippedGearSlot", () => {
  test("takes only what this character has equipped, with live subclass and artifact plugs", () => {
    const slot = equippedGearSlot(
      {
        id: "c1",
        subclassItems: [subclass("s-off", false), subclass("s-on", true)],
        artifacts: [
          { instanceId: "a-off", itemHash: 400, equipped: false, perks: { 1: 9 } },
          { instanceId: "a-on", itemHash: 401, equipped: true, perks: { 0: 8 } },
        ],
      },
      [
        {
          ...piece("p-on", "equipped", "c1"),
          armorSockets: [
            { index: 0, kind: "general", category: "c", plugHash: 801 },
            // An empty tuning socket is named too, so Apply clears it.
            { index: 2, kind: "tuning", category: "c", plugHash: 810, emptyPlugHash: 810 },
            { index: 3, kind: "general", category: "c" },
          ],
        },
        piece("p-other", "equipped", "c2"),
        piece("p-bag", "inventory", "c1"),
        piece("p-vault", "vault"),
      ],
      [weapon("w-on", "equipped", "c1"), weapon("w-bag", "inventory", "c1")],
    );
    expect(slot.items).toEqual([
      { itemInstanceId: "s-on", itemHash: 300, plugs: { 0: 1, 5: 2, 7: 3 } },
      { itemInstanceId: "w-on", itemHash: 200 },
      { itemInstanceId: "p-on", itemHash: 100, plugs: { 0: 801, 2: 810 } },
      { itemInstanceId: "a-on", itemHash: 401, plugs: { 0: 8 } },
    ]);
    expect(slot.empty).toBe(false);
  });

  test("a character with nothing read yet is an empty slot", () => {
    expect(equippedGearSlot({ id: "c1", subclassItems: [] }, [], []).empty).toBe(true);
  });
});

describe("equippedGearName", () => {
  test("subclass and class, or the class alone", () => {
    expect(equippedGearName({ classType: 1, equippedSubclass: { subclass: "Prismatic", fragmentHashes: [] } })).toBe(
      "Prismatic Hunter",
    );
    expect(equippedGearName({ classType: 0 })).toBe("Titan");
  });
});
