import { describe, expect, test } from "vitest";
import type { Manifest } from "../manifest/load";
import type { ArmorPiece } from "../armory/normalize";
import type { LoadoutWeapon } from "../armory/weapons";
import type { SubclassItem } from "../armory/equipped-subclass";
import { SLOT_BUCKETS } from "../armory/stats";
import {
  equippedGearAsLoadout,
  equippedGearItems,
  equippedGearName,
  uniqueLoadoutName,
} from "./equipped-gear";

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

describe("equippedGearItems", () => {
  test("takes only what this character has equipped, each with its live plugs", () => {
    const items = equippedGearItems(
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
    expect(items).toEqual([
      { itemInstanceId: "s-on", itemHash: 300, plugs: { 0: 1, 5: 2, 7: 3 } },
      { itemInstanceId: "w-on", itemHash: 200 },
      { itemInstanceId: "p-on", itemHash: 100, plugs: { 0: 801, 2: 810 } },
      { itemInstanceId: "a-on", itemHash: 401, plugs: { 0: 8 } },
    ]);
  });
});

describe("equippedGearAsLoadout", () => {
  // A helmet with a stat mod, an empty tuning socket and an empty mod socket.
  const defs: Record<number, unknown> = {
    100: { displayProperties: { name: "Helmet" }, inventory: { bucketTypeHash: SLOT_BUCKETS.helmet } },
    800: { displayProperties: { name: "Empty Mod Socket" }, plug: { plugCategoryIdentifier: "enhancements.v2_general" } },
    801: {
      displayProperties: { name: "Health Mod" },
      plug: { plugCategoryIdentifier: "enhancements.v2_general" },
      investmentStats: [{ statTypeHash: 392767087, value: 10 }],
    },
    810: { displayProperties: { name: "Empty Tuning Socket" }, plug: { plugCategoryIdentifier: "armor_tuning" } },
  };
  const manifest = { def: (_table: string, hash: number) => defs[hash] } as unknown as Manifest;
  const helmet = {
    ...piece("helmet", "equipped", "c1"),
    slot: "helmet",
    armorSockets: [
      { index: 1, kind: "general", category: "", plugHash: 801, emptyPlugHash: 800 },
      { index: 2, kind: "tuning", category: "", plugHash: 810, emptyPlugHash: 810 },
      { index: 3, kind: "general", category: "", plugHash: 800, emptyPlugHash: 800 },
    ],
  } as ArmorPiece;
  const save = (existingNames: string[] = []) =>
    equippedGearAsLoadout(
      { id: "c1", classType: 0, subclassItems: [subclass("s", true)] },
      {
        pieces: [helmet],
        weapons: [],
        pieceMap: new Map([["helmet", helmet]]),
        weaponMap: new Map(),
        manifest,
        existingNames,
      },
    );

  test("keeps the mods on, and an empty tuning socket as empty so Apply clears it", () => {
    expect(save().modPlacement).toEqual({ helmet: { 1: 801, 2: 810 } });
  });

  test("named after the equipped subclass, unique among the player's loadouts", () => {
    expect(save().loadout.name).toBe("Arc Titan");
    expect(save(["arc titan", "Arc Titan 2"]).loadout.name).toBe("Arc Titan 3");
  });
});

describe("equippedGearName", () => {
  test("the class alone without a subclass", () => {
    expect(equippedGearName({ classType: 1, subclassItems: [] })).toBe("Hunter");
  });
});

describe("uniqueLoadoutName", () => {
  test("keeps a free name and numbers a taken one", () => {
    expect(uniqueLoadoutName("Build", [])).toBe("Build");
    expect(uniqueLoadoutName("Build", ["Build"])).toBe("Build 2");
  });
});
