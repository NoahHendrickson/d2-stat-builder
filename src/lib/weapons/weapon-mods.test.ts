import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";
import { describe, expect, it } from "vitest";

import type { ManifestDefs } from "./manifest";
import { buildWeaponModOptions } from "./weapon-mods";

const STABILITY = 155_624_089;
const RANGE = 1_240_592_695;
const AMMO_CAPACITY = 925_767_036;
const PLUG_SET = 9001;
const EMPTY = 1;

function mod(
  hash: number,
  name: string,
  stats: [number, number, boolean?][],
  extra: Partial<DestinyInventoryItemDefinition> = {},
): DestinyInventoryItemDefinition {
  return {
    hash,
    itemTypeDisplayName: "Weapon Mod",
    displayProperties: { name, description: "", icon: `/icons/${hash}.png` },
    plug: { plugCategoryIdentifier: "v400.weapon.mod_guns", insertionRules: [] },
    investmentStats: stats.map(([statTypeHash, value, isConditionallyActive = false]) => ({
      statTypeHash,
      value,
      isConditionallyActive,
    })),
    perks: [{ perkHash: hash, perkVisibility: 0 }],
    ...extra,
  } as unknown as DestinyInventoryItemDefinition;
}

const items: Record<number, DestinyInventoryItemDefinition> = {
  [EMPTY]: mod(EMPTY, "Empty Mod Socket", [], {
    plug: { plugCategoryIdentifier: "v400.weapon.mod_empty" },
  } as Partial<DestinyInventoryItemDefinition>),
  10: mod(10, "Ballistics", [[RANGE, 6], [STABILITY, 6]]),
  11: mod(11, "Ballistics", [[RANGE, 7], [STABILITY, 7]], {
    itemTypeDisplayName: "Enhanced Weapon Mod",
  }),
  12: mod(12, "Freehand Grip", []),
  13: mod(13, "Adept Stability", [[STABILITY, 10, true]], {
    plug: {
      plugCategoryIdentifier: "v400.weapon.mod_guns",
      insertionRules: [{ failureMessage: "Requires Adept Weapon" }],
    },
  } as Partial<DestinyInventoryItemDefinition>),
  // Moves only a stat the weapon doesn't show.
  14: mod(14, "Reserves", [[AMMO_CAPACITY, 20]]),
};

const plugSets = {
  [PLUG_SET]: {
    reusablePlugItems: [EMPTY, 10, 11, 12, 13, 14].map((plugItemHash) => ({ plugItemHash })),
  },
} as unknown as ManifestDefs["DestinyPlugSetDefinition"];

const sandboxPerks = {
  10: { displayProperties: { description: "Grants increased range and stability." } },
  11: { displayProperties: { description: "Greatly increases range and stability." } },
  13: { displayProperties: { description: "+10 Stability" } },
} as unknown as ManifestDefs["DestinySandboxPerkDefinition"];

const weapon = {
  hash: 100,
  stats: {
    stats: {
      1: { statHash: STABILITY, value: 50 },
      2: { statHash: RANGE, value: 46 },
      3: { statHash: AMMO_CAPACITY, value: 0 },
    },
  },
  sockets: {
    socketEntries: [{ singleInitialItemHash: EMPTY, reusablePlugSetHash: PLUG_SET }],
  },
} as unknown as DestinyInventoryItemDefinition;

describe("buildWeaponModOptions", () => {
  it("keeps the enhanced version of a mod and drops mods that move no shown stat", () => {
    const mods = buildWeaponModOptions(weapon, items, plugSets, sandboxPerks, false);
    expect(mods).toEqual([
      {
        hash: 11,
        name: "Ballistics",
        icon: "/icons/11.png",
        currentlyCanRoll: true,
        description: "Greatly increases range and stability.",
        statMods: [
          { hash: RANGE, value: 7 },
          { hash: STABILITY, value: 7 },
        ],
      },
    ]);
  });

  it("offers adept mods, with their conditional stats, only on adept weapons", () => {
    const mods = buildWeaponModOptions(weapon, items, plugSets, sandboxPerks, true);
    expect(mods?.map((m) => [m.name, m.statMods])).toEqual([
      [
        "Ballistics",
        [
          { hash: RANGE, value: 7 },
          { hash: STABILITY, value: 7 },
        ],
      ],
      ["Adept Stability", [{ hash: STABILITY, value: 10 }]],
    ]);
  });

  it("returns undefined without a mod socket", () => {
    const bare = { ...weapon, sockets: { socketEntries: [] } } as unknown as DestinyInventoryItemDefinition;
    expect(buildWeaponModOptions(bare, items, plugSets, sandboxPerks, false)).toBeUndefined();
  });
});
