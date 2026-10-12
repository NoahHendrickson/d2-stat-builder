import { describe, expect, test } from "vitest";
import type { Manifest } from "../manifest/load";
import type { ArmorPiece } from "../armory/normalize";
import type { LoadoutWeapon } from "../armory/weapons";
import type { InGameLoadoutSlot } from "../bungie/ingame-loadouts";
import { SLOT_BUCKETS, STAT_HASHES, STAT_HASH_TO_INDEX, type ArmorSlot } from "../armory/stats";
import { ARTIFACT_BUCKET } from "../armory/artifact-items";
import { SUPER_SOCKET_CATEGORY_HASH } from "../dim/subclasses";
import { planLoadoutPlugs, type PlugInfo } from "./apply-plan";
import { inGameImportName, inGameSlotToLoadout, slotItemOrder } from "./ingame-import";

// Striker: abilities at 0–4, aspects 5–6, fragments 7–12 (FRAGMENT_SOCKET_START.Arc = 7).
const STRIKER = 2932390016;
const socket = (empty: number, set: number, socketTypeHash?: number) => ({
  singleInitialItemHash: empty,
  reusablePlugSetHash: set,
  socketTypeHash,
});
const item = (name: string, extra: object = {}) => ({
  displayProperties: { name, description: "" },
  ...extra,
});
const HEALTH = STAT_HASH_TO_INDEX[STAT_HASHES.health];

const items: Record<number, unknown> = {
  [STRIKER]: item("Striker", {
    sockets: {
      socketEntries: [
        socket(301, 12, 50),
        socket(401, 13, 51),
        socket(411, 14, 52),
        socket(421, 15, 53),
        socket(431, 16, 54),
        socket(90, 10),
        socket(90, 10),
        ...Array(6).fill(socket(91, 11)),
      ],
    },
  }),
  90: item("Empty Aspect Socket"),
  91: item("Empty Fragment Socket"),
  101: item("Aspect", { investmentStats: [{ statTypeHash: 2223994109, value: 2 }] }),
  201: item("Fragment"),
  301: item("Fist of Havoc"),
  302: item("Thundercrash"),
  700: item("Kinetic gun", { inventory: { bucketTypeHash: 1498876634 } }),
  701: item("Rocket", { inventory: { bucketTypeHash: 953998645 } }),
  800: item("Empty Mod Socket", { plug: { plugCategoryIdentifier: "enhancements.v2_general" } }),
  801: item("Health Mod", {
    plug: { plugCategoryIdentifier: "enhancements.v2_general" },
    investmentStats: [{ statTypeHash: STAT_HASHES.health, value: 10 }],
  }),
  802: item("A shader", { plug: { plugCategoryIdentifier: "shader" } }),
  // A placeholder the socket definition doesn't name as its empty plug.
  803: item("Locked Armor Mod", { plug: { plugCategoryIdentifier: "enhancements.v2_general" } }),
  810: item("Empty Tuning Socket", { plug: { plugCategoryIdentifier: "armor_tuning" } }),
  811: item("Tuning", {
    plug: { plugCategoryIdentifier: "armor_tuning" },
    investmentStats: [
      { statTypeHash: STAT_HASHES.health, value: 5 },
      { statTypeHash: STAT_HASHES.melee, value: -5 },
    ],
  }),
  820: item("Empty Artifice Socket", { plug: { plugCategoryIdentifier: "enhancements.artifice" } }),
  821: item("Artifice Health", {
    plug: { plugCategoryIdentifier: "enhancements.artifice" },
    investmentStats: [{ statTypeHash: STAT_HASHES.health, value: 3 }],
  }),
  // An artifact: two perk sockets (empty plug 1010) and the reset socket.
  1000: item("Artifact", {
    inventory: { bucketTypeHash: ARTIFACT_BUCKET },
    sockets: { socketEntries: [socket(1010, 20, 60), socket(1010, 20, 60), socket(1011, 21, 61)] },
  }),
};
for (const [slot, bucket] of Object.entries(SLOT_BUCKETS)) {
  items[900 + Object.keys(SLOT_BUCKETS).indexOf(slot)] = item(slot, {
    inventory: { bucketTypeHash: bucket },
  });
}
const tables: Record<string, Record<number, unknown>> = {
  DestinyInventoryItemDefinition: items,
  DestinyPlugSetDefinition: {
    10: { reusablePlugItems: [90, 101].map((plugItemHash) => ({ plugItemHash })) },
    11: { reusablePlugItems: [91, 201].map((plugItemHash) => ({ plugItemHash })) },
    12: { reusablePlugItems: [301, 302].map((plugItemHash) => ({ plugItemHash })) },
    20: { reusablePlugItems: [1010, 1001, 1002].map((plugItemHash) => ({ plugItemHash })) },
  },
  DestinySocketTypeDefinition: {
    50: { socketCategoryHash: SUPER_SOCKET_CATEGORY_HASH },
    51: { plugWhitelist: [{ categoryIdentifier: "titan.arc.class_abilities" }] },
    52: { plugWhitelist: [{ categoryIdentifier: "titan.arc.movement" }] },
    53: { plugWhitelist: [{ categoryIdentifier: "titan.arc.melee" }] },
    54: { plugWhitelist: [{ categoryIdentifier: "shared.arc.grenades" }] },
    60: { plugWhitelist: [{ categoryIdentifier: "artifact_perks" }] },
    61: { plugWhitelist: [{ categoryIdentifier: "artifact_perks" }, { categoryIdentifier: "artifact_reset" }] },
  },
};
const manifest = {
  def: (table: string, hash: number) => tables[table]?.[hash],
} as unknown as Manifest;

const SLOTS: ArmorSlot[] = ["helmet", "arms", "chest", "legs", "classItem"];
const piece = (slot: ArmorSlot, i: number): ArmorPiece =>
  ({
    instanceId: slot,
    itemHash: 900 + i,
    name: slot,
    slot,
    classType: 0,
    isExotic: slot === "chest",
    baseStats: [10, 10, 10, 10, 10, 10],
    stats: [12, 12, 12, 12, 12, 12],
    power: 400,
    armorSockets: [
      { index: 1, kind: "general", category: "", emptyPlugHash: 800 },
      // The helmet is tuned now; the arms hold an artifice mod now.
      ...(slot === "helmet" ? [{ index: 2, kind: "tuning", category: "", emptyPlugHash: 810, plugHash: 811 }] : []),
      ...(slot === "arms" ? [{ index: 3, kind: "artifice", category: "", emptyPlugHash: 820, plugHash: 821 }] : []),
    ],
  }) as unknown as ArmorPiece;
const pieces = SLOTS.map(piece);
const pieceMap = new Map(pieces.map((p) => [p.instanceId, p]));
const weaponMap = new Map<string, LoadoutWeapon>([
  ["k", { instanceId: "k", itemHash: 700, slot: "kinetic", power: 410 } as LoadoutWeapon],
]);

// In the game's own order: weapons and subclass first, armor after, a dismantled item.
const slot: InGameLoadoutSlot = {
  index: 2,
  nameHash: 1,
  iconHash: 1,
  colorHash: 1,
  empty: false,
  items: [
    { itemInstanceId: "p", itemHash: 701 },
    { itemInstanceId: "k", itemHash: 700 },
    {
      itemInstanceId: "sc",
      itemHash: STRIKER,
      // 302 super, 101 aspect + an empty aspect, a fragment, a plug no Striker socket
      // takes (dropped), and a socket this app doesn't model (dropped).
      plugs: { 0: 302, 5: 101, 6: 90, 7: 201, 8: 999, 20: 555 },
    },
    { itemInstanceId: "gone" },
    // A perk, an empty perk socket, and the reset socket (dropped).
    { itemInstanceId: "art", itemHash: 1000, plugs: { 0: 1001, 1: 1010, 2: 1011 } },
    { itemInstanceId: "legs", itemHash: 903, plugs: { 1: 801 } },
    // The slot empties the helmet's tuning socket.
    { itemInstanceId: "helmet", itemHash: 900, plugs: { 1: 800, 2: 810 } },
    // The slot leaves the arms' artifice socket alone, so the live mod stays.
    { itemInstanceId: "arms", itemHash: 901, plugs: { 1: 802 } },
    { itemInstanceId: "chest", itemHash: 902, plugs: { 4: 801 } },
    { itemInstanceId: "classItem", itemHash: 904, plugs: { 1: 803 } },
  ],
};

describe("inGameSlotToLoadout", () => {
  const data = inGameSlotToLoadout({
    slot,
    name: "  Raid  ",
    classType: 0,
    pieceMap,
    weaponMap,
    manifest,
  });

  test("armor and weapons in slot order, then the artifact and the subclass", () => {
    expect(data.loadout.name).toBe("Raid");
    expect(data.loadout.equipped.map((r) => r.id ?? r.hash)).toEqual([
      "helmet",
      "arms",
      "chest",
      "legs",
      "classItem",
      "k",
      "p",
      "art",
      STRIKER,
    ]);
    expect(data.loadout.parameters.exoticArmorHash).toBe(902);
  });

  test("the subclass keeps only plugs its modelled sockets can take", () => {
    const subclass = data.loadout.equipped.find((r) => r.hash === STRIKER);
    expect(subclass?.socketOverrides).toEqual({ 0: 302, 5: 101, 6: 90, 7: 201 });
  });

  test("the artifact keeps the perks its perk sockets take", () => {
    const artifact = data.loadout.equipped.find((r) => r.hash === 1000);
    expect(artifact?.socketOverrides).toEqual({ 0: 1001 });
  });

  test("armor mods come from the slot, live plugs fill what it leaves alone", () => {
    // Empty mod sockets, placeholders and cosmetics are left out; an emptied tuning
    // socket is kept as its empty plug so Apply clears the live tune.
    expect(data.modPlacement).toEqual({ helmet: { 2: 810 }, arms: { 3: 821 }, legs: { 1: 801 } });
    expect(data.loadout.parameters.mods).toEqual([810, 821, 801]);
  });

  test("Apply clears an emptied tuning socket and puts back a left-alone artifice mod", () => {
    const plugInfo = (hash: number): PlugInfo | undefined => {
      const cat = (items[hash] as { plug?: { plugCategoryIdentifier: string } } | undefined)?.plug
        ?.plugCategoryIdentifier;
      const kind = cat === "armor_tuning" ? "tuning" : cat === "enhancements.artifice" ? "artifice" : "general";
      return { kind, name: String(hash), cost: kind === "general" ? 3 : 0 };
    };
    const plan = planLoadoutPlugs({
      pieces: [
        { instanceId: "helmet", name: "helmet", sockets: [{ index: 2, kind: "tuning", current: 811, empty: 810 }] },
        { instanceId: "arms", name: "arms", sockets: [{ index: 3, kind: "artifice", current: 820, empty: 820 }] },
      ],
      modHashes: data.loadout.parameters.mods,
      plugInfo,
      placements: data.modPlacement,
    });
    expect(plan.plugs.map((p) => [p.itemInstanceId, p.socketIndex, p.plugItemHash])).toEqual([
      ["helmet", 2, 810],
      ["arms", 3, 821],
    ]);
  });

  test("a full armor set gets the card's stat totals", () => {
    const expected = [60, 60, 60, 60, 60, 60];
    expected[HEALTH] += 10 + 3;
    expect(data.optimizer?.stats).toEqual(expected);
    expect(data.optimizer?.total).toBe(373);
    expect(data.optimizer?.modsUsed).toEqual({ major: 1, minor: 0 });
    expect(data.optimizer?.tuning).toEqual([null, null, null, null, null]);
    expect(data.optimizer?.artifice).toEqual([null, HEALTH, null, null, null]);
    expect(data.optimizer?.pieceIds).toEqual(SLOTS);
    // Five armor pieces at 400 and the one weapon with a known power.
    expect(data.optimizer?.power).toBe(Math.floor((5 * 400 + 410) / 6));
  });

  test("without all five pieces there are no totals", () => {
    const partial = inGameSlotToLoadout({
      slot: { ...slot, items: slot.items.filter((i) => i.itemInstanceId !== "legs") },
      name: "Raid",
      classType: 0,
      pieceMap,
      weaponMap,
      manifest,
    });
    expect(partial.optimizer).toBeUndefined();
    expect(partial.modPlacement?.legs).toBeUndefined();
  });
});

test("inGameImportName uses the game's name, else the slot number", () => {
  const names = [{ hash: 1, name: "Raid" }];
  expect(inGameImportName(slot, names)).toBe("Raid");
  expect(inGameImportName({ ...slot, nameHash: 99 }, names)).toBe("Loadout 3");
});

test("slotItemOrder lists subclass, weapons, armor, then the artifact", () => {
  const hashes = [1000, 903, 900, 701, STRIKER, 700];
  hashes.sort((a, b) => slotItemOrder(manifest, a) - slotItemOrder(manifest, b));
  expect(hashes).toEqual([STRIKER, 700, 701, 900, 903, 1000]);
});
