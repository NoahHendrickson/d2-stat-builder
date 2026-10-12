import { expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { addInvestment, weaponRoll, weaponStats } from "./weapon-details";

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

test("adds a tiered weapon's full-masterwork bonus that the live stats leave out", () => {
  // Cusp Sempiternal, Tier 5, Masterworked: Range: the API says 66 Range, in-game shows 71.
  const RANGE = 1240592695;
  const STABILITY = 155624089;
  const HANDLING = 943549884;
  const AIM_ASSIST = 1345609583;
  const DRAW_TIME = 447667954;
  const tieredItems: Record<number, object> = {
    ...items,
    61: {
      ...plug("Masterworked: Range", "v400.plugs.weapons.masterworks.stat.range"),
      investmentStats: [
        { statTypeHash: RANGE, value: 10, isConditionallyActive: false },
        { statTypeHash: STABILITY, value: 0, isConditionallyActive: true },
        { statTypeHash: RANGE, value: 0, isConditionallyActive: true },
        { statTypeHash: HANDLING, value: 0, isConditionallyActive: true },
        { statTypeHash: DRAW_TIME, value: 0, isConditionallyActive: true },
      ],
    },
    62: {
      ...plug("Tier 2: Range", "v400.plugs.weapons.masterworks.stat.range"),
      investmentStats: [{ statTypeHash: RANGE, value: 2, isConditionallyActive: false }],
    },
  };
  const tieredStats: Record<number, object> = {
    [RANGE]: { displayProperties: { name: "Range" } },
    [STABILITY]: { displayProperties: { name: "Stability" } },
    [HANDLING]: { displayProperties: { name: "Handling" } },
    [AIM_ASSIST]: { displayProperties: { name: "Aim Assistance" } },
    [DRAW_TIME]: { displayProperties: { name: "Draw Time" } },
  };
  const tieredManifest = {
    def: (table: string, hash: number | null | undefined) =>
      hash == null ? undefined : table === "DestinyStatDefinition" ? tieredStats[hash] : tieredItems[hash],
  } as unknown as Manifest;
  const weapon = (masterworkPlug: number, gearTier: number) =>
    ({
      itemComponents: {
        instances: { data: { w: { gearTier } } },
        sockets: { data: { w: { sockets: [10, masterworkPlug].map((plugHash) => ({ plugHash, isVisible: true })) } } },
        stats: {
          data: {
            w: {
              stats: {
                [RANGE]: { statHash: RANGE, value: 66 },
                [STABILITY]: { statHash: STABILITY, value: 98 },
                [HANDLING]: { statHash: HANDLING, value: 64 },
                [AIM_ASSIST]: { statHash: AIM_ASSIST, value: 74 },
                [DRAW_TIME]: { statHash: DRAW_TIME, value: 600 },
              },
            },
          },
        },
      },
    }) as unknown as DestinyProfileResponse;
  const read = (profile: DestinyProfileResponse, curves?: Parameters<typeof weaponStats>[3]) =>
    Object.fromEntries(weaponStats(profile, tieredManifest, "w", curves).map((s) => [s.name, s.value]));

  // +5 on each conditional stat, capped at 100; Aim Assistance isn't listed; a time
  // without its curve stays put.
  expect(read(weapon(61, 5))).toEqual({
    Range: 71,
    Stability: 100,
    Handling: 69,
    "Aim Assistance": 74,
    "Draw Time": 600,
  });
  // With the curve, a time moves the way the game interpolates it (833ms → 500ms).
  expect(read(weapon(61, 5), { "Draw Time": { max: 100, points: [[0, 833], [100, 500]] } })["Draw Time"]).toBe(583);
  // Part-masterworked or untiered: nothing to add.
  expect(read(weapon(62, 5)).Range).toBe(66);
  expect(read(weapon(61, 0)).Range).toBe(66);
});

test("leaves a bottomed-out stat and non-bar stats alone when adding investment", () => {
  const linear = { max: 100, points: [[0, 0], [100, 100]] as [number, number][] };
  // Disorienting Grenades take Blast Radius to -100: it reads 0, and +5 doesn't move it.
  expect(addInvestment("Blast Radius", 0, 5, linear)).toBe(0);
  expect(addInvestment("Blast Radius", 0, 5)).toBe(0);
  // Without a curve, only the game's 0–100 bars move: Cooling Efficiency reads 320.
  expect(addInvestment("Cooling Efficiency", 320, 5)).toBe(320);
  expect(addInvestment("Charge Time", 533, 5)).toBe(533);
  expect(addInvestment("Range", 97, 5)).toBe(100);
});
