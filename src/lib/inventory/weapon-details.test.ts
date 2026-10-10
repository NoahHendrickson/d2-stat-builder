import { expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { weaponRoll, weaponStats } from "./weapon-details";

const plug = (name: string, category: string) => ({
  displayProperties: { name, icon: `/${name}.png` },
  plug: { plugCategoryIdentifier: category },
});
const items: Record<number, object> = {
  10: plug("Area Denial Frame", "intrinsics"),
  20: plug("Hard Launch", "barrels"),
  21: plug("Quick Launch", "barrels"),
  30: plug("Chaos Reshaped", "frames"),
  31: plug("Air Trigger", "frames"),
  40: plug("Default Shader", "shader"),
  50: plug("Empty Mod Socket", "v400.weapon.mod_empty"),
  60: plug("Tier 1: Blast Radius", "v400.plugs.weapons.masterworks.stat.blast_radius"),
  70: plug("Kill Tracker", "v400.plugs.weapons.masterworks.trackers"),
  80: plug("Default Ornament", "weapon_tiering_tier5_skins"),
};
const stats: Record<number, object> = {
  1: { displayProperties: { name: "Blast Radius" } },
  2: { displayProperties: { name: "Rounds Per Minute" } },
  3: { displayProperties: { name: "Handling" } },
  4: { displayProperties: { name: "Attack" } },
};
const manifest = {
  def: (table: string, hash: number | null | undefined) =>
    hash == null
      ? undefined
      : table === "DestinyStatDefinition"
        ? stats[hash]
        : items[hash],
} as unknown as Manifest;

const profile = {
  itemComponents: {
    sockets: {
      data: {
        w: {
          sockets: [10, 20, 30, 40, 50, 60, 70, 80].map((plugHash) => ({ plugHash, isVisible: true })),
        },
      },
    },
    reusablePlugs: {
      data: { w: { plugs: { 1: [{ plugItemHash: 20 }, { plugItemHash: 21 }], 2: [{ plugItemHash: 31 }] } } },
    },
    stats: {
      data: {
        w: {
          stats: {
            2: { statHash: 2, value: 72 },
            3: { statHash: 3, value: 68 },
            1: { statHash: 1, value: 100 },
            4: { statHash: 4, value: 10 },
          },
        },
      },
    },
  },
} as unknown as DestinyProfileResponse;

test("splits a weapon's sockets into frame, perk columns, and mods", () => {
  const roll = weaponRoll(profile, manifest, "w");
  expect(roll.frame?.name).toBe("Area Denial Frame");
  expect(roll.columns.map((c) => [c.current.name, c.options.map((o) => o.name)])).toEqual([
    ["Hard Launch", ["Hard Launch", "Quick Launch"]],
    // The current perk is kept even when the rolled list doesn't include it.
    ["Chaos Reshaped", ["Chaos Reshaped", "Air Trigger"]],
  ]);
  expect(roll.mods.map((m) => [m.kind, m.name])).toEqual([
    ["shader", "Default Shader"],
    ["mod", "Empty Mod Socket"],
    ["masterwork", "Tier 1: Blast Radius"],
    ["ornament", "Default Ornament"],
  ]);
});

test("lists the stats the game shows, in its order", () => {
  expect(weaponStats(profile, manifest, "w").map((s) => `${s.name} ${s.value}`)).toEqual([
    "Blast Radius 100",
    "Handling 68",
    "Rounds Per Minute 72",
  ]);
});

test("keeps a crossbow's rail and bolt columns", () => {
  const crossbowItems: Record<number, object> = {
    ...items,
    90: plug("Mag-lev Rail", "rails"),
    91: plug("Explosive Bolts", "bolts"),
  };
  const crossbowManifest = {
    def: (table: string, hash: number | null | undefined) =>
      hash == null || table === "DestinyStatDefinition" ? undefined : crossbowItems[hash],
  } as unknown as Manifest;
  const crossbow = {
    itemComponents: {
      sockets: {
        data: { x: { sockets: [10, 90, 91, 30].map((plugHash) => ({ plugHash, isVisible: true })) } },
      },
    },
  } as unknown as DestinyProfileResponse;
  expect(
    weaponRoll(crossbow, crossbowManifest, "x").columns.map((c) => [c.category, c.current.name]),
  ).toEqual([
    ["rails", "Mag-lev Rail"],
    ["bolts", "Explosive Bolts"],
    ["frames", "Chaos Reshaped"],
  ]);
});
