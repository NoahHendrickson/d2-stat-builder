import { test, expect } from "vitest";
import type { ArmorPiece } from "../armory/normalize";
import { SUPER_SOCKET_CATEGORY_HASH } from "../dim/subclasses";
import { resolveLoadout, type DefLookup } from "./resolve";

const SUPER_TYPE = 50;
const GRENADE_TYPE = 51;
const manifest: DefLookup = {
  def: (table, hash) => {
    if (table === "DestinySocketTypeDefinition" && hash === SUPER_TYPE) {
      return { socketCategoryHash: SUPER_SOCKET_CATEGORY_HASH };
    }
    if (table === "DestinySocketTypeDefinition" && hash === GRENADE_TYPE) {
      return { plugWhitelist: [{ categoryIdentifier: "hunter.prism.grenades" }] };
    }
    if (hash === 4282591831) {
      return { sockets: { socketEntries: [
        { singleInitialItemHash: 0, socketTypeHash: SUPER_TYPE },
        // The default grenade: a loadout that picks it still lists it.
        { singleInitialItemHash: 88, socketTypeHash: GRENADE_TYPE },
      ] } };
    }
    if (hash === 200) {
      return { displayProperties: { name: "Gone Helm", icon: "/h.png" }, inventory: { bucketTypeHash: 3448274439 } };
    }
    return undefined;
  },
};

const piece = (instanceId: string, slot: ArmorPiece["slot"]): ArmorPiece =>
  ({ instanceId, itemHash: 1, name: `live ${slot}`, slot, stats: [] }) as unknown as ArmorPiece;

const pieceMap = new Map([
  ["c1", piece("c1", "chest")],
  ["a1", piece("a1", "arms")],
]);

test("resolves live pieces, flags missing ones, orders by slot, extracts subclass plugs", () => {
  const out = resolveLoadout(
    {
      id: "x",
      name: "n",
      classType: 1,
      unequipped: [],
      parameters: { mods: [], assumeArmorMasterwork: 3 },
      equipped: [
        { id: "c1", hash: 1 },
        { id: "gone", hash: 200 },
        { id: "a1", hash: 1 },
        // Prismatic Hunter carrier: fragments start at socket 9
        { id: "12345", hash: 4282591831, socketOverrides: { 0: 77, 1: 88, 10: 22, 9: 11 } },
      ],
    },
    pieceMap,
    manifest,
  );
  expect(out.armor.map((a) => [a.name, a.slot, a.missing])).toEqual([
    ["Gone Helm", "helmet", true],
    ["live arms", "arms", false],
    ["live chest", "chest", false],
  ]);
  expect(out.subclass).toEqual({
    itemHash: 4282591831,
    subclass: "Prismatic",
    fragmentHashes: [11, 22],
    aspectHashes: [],
    superHash: 77,
    abilityHashes: { super: 77, grenade: 88 },
    socketOverrides: { 0: 77, 1: 88, 10: 22, 9: 11 },
  });
  expect(out.missing).toBe(true);
  expect(out.actionable).toBe(false);
});

test("actionable only when every piece is live and none is synthetic", () => {
  const base = {
    id: "x",
    name: "n",
    classType: 1,
    unequipped: [],
    parameters: { mods: [], assumeArmorMasterwork: 3 },
  };
  expect(
    resolveLoadout({ ...base, equipped: [{ id: "c1", hash: 1 }] }, pieceMap, manifest)
      .actionable,
  ).toBe(true);
  const synthetic = new Map(pieceMap);
  synthetic.set("synthetic-class-item:1", piece("synthetic-class-item:1", "classItem"));
  expect(
    resolveLoadout(
      { ...base, equipped: [{ id: "synthetic-class-item:1", hash: 1 }] },
      synthetic,
      manifest,
    ).actionable,
  ).toBe(false);
});

test("weapons resolve apart from armor, in slot order, and a missing one doesn't block equipping", () => {
  const weaponManifest: DefLookup = {
    def: (table, hash) =>
      hash === 900
        ? { displayProperties: { name: "Gone Rocket", icon: "/r.png" }, inventory: { bucketTypeHash: 953998645 } }
        : manifest.def(table, hash),
  };
  const weaponMap = new Map([
    ["w1", { instanceId: "w1", itemHash: 5, name: "live energy", slot: "energy" as const, typeName: "Fusion Rifle", isExotic: false, location: "vault" as const }],
  ]);
  const out = resolveLoadout(
    {
      id: "x",
      name: "n",
      classType: 1,
      unequipped: [],
      parameters: { mods: [], assumeArmorMasterwork: 3 },
      equipped: [
        { id: "gone-rocket", hash: 900 },
        { id: "c1", hash: 1 },
        { id: "w1", hash: 5 },
      ],
    },
    pieceMap,
    weaponManifest,
    weaponMap,
  );
  expect(out.armor.map((a) => a.name)).toEqual(["live chest"]);
  expect(out.weapons.map((w) => [w.name, w.slot, w.missing])).toEqual([
    ["live energy", "energy", false],
    ["Gone Rocket", "power", true],
  ]);
  expect(out.missing).toBe(true);
  expect(out.actionable).toBe(true);
});

test("an artifact resolves on its own and never counts as missing", () => {
  const artifactManifest: DefLookup = {
    def: (table, hash) =>
      table === "DestinyInventoryItemDefinition" && hash === 700
        ? { displayProperties: { name: "Tablet of Ruin", icon: "/t.png" }, inventory: { bucketTypeHash: 1506418338 } }
        : manifest.def(table, hash),
  };
  const out = resolveLoadout(
    {
      id: "x",
      name: "n",
      classType: 1,
      unequipped: [],
      parameters: { mods: [], assumeArmorMasterwork: 3 },
      equipped: [
        { id: "c1", hash: 1 },
        { id: "art", hash: 700, socketOverrides: { 5: 30, 0: 10, 2: 20 } },
      ],
    },
    pieceMap,
    artifactManifest,
  );
  expect(out.armor.map((a) => a.name)).toEqual(["live chest"]);
  expect(out.artifact).toMatchObject({ itemHash: 700, name: "Tablet of Ruin", perks: [10, 20, 30] });
  expect(out.missing).toBe(false);
  expect(out.actionable).toBe(true);
});
