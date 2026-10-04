import { describe, expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { STAT_HASHES } from "@/lib/armory/stats";
import { armorDetails } from "./armor-details";

function tuning(plus: number, minus: number) {
  return {
    plug: { plugCategoryIdentifier: "core.gear_systems.armor_tiering.plugs.tuning.mods" },
    investmentStats: [{ statTypeHash: plus, value: 5 }, { statTypeHash: minus, value: -5 }],
  };
}

const defs: Record<string, Record<number, object>> = {
  DestinyInventoryItemDefinition: {
    1: { equippingBlock: { equipableItemSetHash: 50 } },
    10: { displayProperties: { name: "Stat roll" }, plug: { plugCategoryIdentifier: "armor_stats" } },
    11: { displayProperties: { name: "Gunner", icon: "/g.png" }, plug: { plugCategoryIdentifier: "armor_archetypes" } },
    12: { displayProperties: { name: "Empty Mod Socket" }, plug: { plugCategoryIdentifier: "enhancements.v2_general" } },
    13: { displayProperties: { name: "Weapons Mod", description: "+10" }, plug: { plugCategoryIdentifier: "enhancements.v2_general" } },
    14: { displayProperties: { name: "Default Shader" }, plug: { plugCategoryIdentifier: "shader" } },
    // Tuning: +5 to the tuned stat and −5 to another, or Balanced (+1 to three).
    20: tuning(STAT_HASHES.grenade, STAT_HASHES.weapons),
    21: tuning(STAT_HASHES.grenade, STAT_HASHES.health),
    22: tuning(STAT_HASHES.super, STAT_HASHES.health),
    23: {
      plug: { plugCategoryIdentifier: "core.gear_systems.armor_tiering.plugs.tuning.mods" },
      investmentStats: [{ statTypeHash: STAT_HASHES.class, value: 1 }, { statTypeHash: STAT_HASHES.melee, value: 1 }],
    },
  },
  DestinyEquipableItemSetDefinition: {
    50: { displayProperties: { name: "Techsec" }, setPerks: [{ requiredSetCount: 2, sandboxPerkHash: 60 }] },
  },
  DestinySandboxPerkDefinition: { 60: { displayProperties: { name: "Overclocked", description: "Faster" } } },
};
const manifest = {
  def: (table: string, hash: number | null | undefined) => (hash == null ? undefined : defs[table]?.[hash]),
} as unknown as Manifest;

test("reads live stats, archetype, set bonus, energy, and real plugs", () => {
  const profile = {
    itemComponents: {
      stats: {
        data: {
          a: { stats: { [STAT_HASHES.weapons]: { statHash: STAT_HASHES.weapons, value: 40 }, [STAT_HASHES.health]: { statHash: STAT_HASHES.health, value: 12 } } },
        },
      },
      instances: { data: { a: { energy: { energyCapacity: 11, energyUsed: 3 } } } },
      sockets: {
        data: {
          a: { sockets: [{ plugHash: 10 }, { plugHash: 11 }, { plugHash: 12 }, { plugHash: 13 }, { plugHash: 14 }, { plugHash: 13, isVisible: false }] },
        },
      },
    },
  } as unknown as DestinyProfileResponse;

  const details = armorDetails(profile, manifest, "a", 1);
  expect(details.stats.find((s) => s.key === "weapons")?.value).toBe(40);
  expect(details.archetype?.name).toBe("Gunner");
  expect(details.set).toEqual({ name: "Techsec", perks: [{ count: 2, name: "Overclocked", description: "Faster" }] });
  expect(details.energy).toEqual({ used: 3, capacity: 11 });
  expect(details.plugs.map((p) => p.name)).toEqual(["Weapons Mod"]);
});

describe("tunable", () => {
  const withTuning = (plugs: number[]) =>
    armorDetails(
      {
        itemComponents: {
          reusablePlugs: { data: { a: { plugs: { 11: plugs.map((plugItemHash) => ({ plugItemHash })) } } } },
        },
      } as unknown as DestinyProfileResponse,
      manifest,
      "a",
      1,
    ).tunable;

  test("is the stat every directional tuning raises", () => {
    expect(withTuning([23, 20, 21])).toBe("grenade");
  });

  test("is any stat when the tunings raise different ones (exotics)", () => {
    expect(withTuning([20, 22])).toBe("any");
  });

  test("is undefined without directional tuning", () => {
    expect(withTuning([])).toBeUndefined();
    expect(withTuning([23])).toBeUndefined();
  });
});
