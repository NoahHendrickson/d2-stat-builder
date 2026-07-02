import { test, expect } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { computeBaseStats, normalizeArmory } from "./normalize";
import { STAT_HASHES } from "./stats";

const H = STAT_HASHES;

type Plug = {
  plug: { plugCategoryIdentifier: string };
  investmentStats: { statTypeHash: number; value: number }[];
};

function mkProfile(
  id: string,
  stats: Record<number, number>,
  plugHashes: number[],
): DestinyProfileResponse {
  return {
    itemComponents: {
      stats: {
        data: {
          [id]: {
            stats: Object.fromEntries(
              Object.entries(stats).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: {
        data: { [id]: { sockets: plugHashes.map((plugHash) => ({ plugHash })) } },
      },
    },
  } as unknown as DestinyProfileResponse;
}

function mkManifest(plugs: Record<number, Plug>): Manifest {
  return {
    def: (_table: string, hash: number | null | undefined) =>
      hash == null ? undefined : plugs[hash],
  } as unknown as Manifest;
}

test("Balanced Tuning strips off-archetype stats only, leaving the archetype capped", () => {
  // Archetype weapons/super/grenade = 30/25/20; off-arch health/class/melee = 6 (5 MW + 1 balanced).
  const cur = {
    [H.weapons]: 30,
    [H.health]: 6,
    [H.class]: 6,
    [H.grenade]: 20,
    [H.super]: 25,
    [H.melee]: 6,
  };
  const BAL = 111;
  const manifest = mkManifest({
    [BAL]: {
      plug: { plugCategoryIdentifier: "armor_tuning_balanced" },
      // Manifest lie: Balanced Tuning lists +1 to all six stats.
      investmentStats: Object.values(H).map((statTypeHash) => ({
        statTypeHash,
        value: 1,
      })),
    },
  });
  // STAT_ORDER [weapons, health, class, grenade, super, melee]. Archetype must stay 30/25/20.
  expect(computeBaseStats("bond", mkProfile("bond", cur, [BAL]), manifest)).toEqual([
    30, 5, 5, 20, 25, 5,
  ]);
});

/**
 * Armor 3.0 exotics carry an intrinsic stat bonus on the item DEFINITION's
 * investmentStats (e.g. Sanguine Alchemy: +10 health, +10 class). The live stats
 * component (304) never includes it, so normalize must add it on top of the roll.
 * Real-world regression: without it, Sanguine builds under-report class/super vs
 * D2ArmorPicker (96/81 instead of 100/90 at weapon 200).
 */
test("a Tier-5 exotic's def-level intrinsic stats are added to stats, not baseStats", () => {
  const ITEM = 999;
  const TUNE_PLUG = 555;
  // Roll: archetype weapons/class/super = 30/20/25, off-arch health/grenade/melee = 0.
  const cur = {
    [H.weapons]: 30,
    [H.health]: 0,
    [H.class]: 20,
    [H.grenade]: 0,
    [H.super]: 25,
    [H.melee]: 0,
  };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2, // armor
      classType: 2,
      displayProperties: { name: "Sanguine Alchemy" },
      inventory: { bucketTypeHash: 14239492, tierType: 6 }, // chest, exotic
      investmentStats: [
        { statTypeHash: H.health, value: 10, isConditionallyActive: false },
        { statTypeHash: H.class, value: 10, isConditionallyActive: false },
        { statTypeHash: H.weapons, value: 0, isConditionallyActive: false },
        // Conditionally-active entries must be ignored.
        { statTypeHash: H.melee, value: 99, isConditionallyActive: true },
      ],
    },
    [TUNE_PLUG]: {
      plug: {
        plugCategoryIdentifier:
          "core.gear_systems.armor_tiering.plugs.tuning.mods",
      },
      investmentStats: [
        { statTypeHash: H.weapons, value: 5 },
        { statTypeHash: H.health, value: -5 },
      ],
    },
  };
  const manifest = {
    def: (_table: string, hash: number | null | undefined) =>
      hash == null ? undefined : defs[hash],
  } as unknown as Manifest;
  const profile = {
    itemComponents: {
      stats: {
        data: {
          ex1: {
            stats: Object.fromEntries(
              Object.entries(cur).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: { data: { ex1: { sockets: [] } } },
      // Tuning socket present (component 310) → the piece is Tier 5 / Armor 3.0.
      reusablePlugs: {
        data: { ex1: { plugs: { 14: [{ plugItemHash: TUNE_PLUG }] } } },
      },
    },
    profileInventory: { data: { items: [{ itemInstanceId: "ex1", itemHash: ITEM }] } },
  } as unknown as DestinyProfileResponse;

  const pieces = normalizeArmory(profile, manifest);
  expect(pieces).toHaveLength(1);
  const p = pieces[0];
  // Base roll untouched — off-archetype/masterwork math must not see the intrinsic.
  expect(p.baseStats).toEqual([30, 0, 20, 0, 25, 0]);
  // stats = roll + MW5 on the 3 off-arch stats + intrinsic (+10 health, +10 class).
  expect(p.stats).toEqual([30, 15, 30, 5, 25, 5]);

  // The same piece WITHOUT a tuning socket is Armor 2.0 — no intrinsic bonus applies.
  const legacy = {
    ...profile,
    itemComponents: {
      ...(profile as { itemComponents: object }).itemComponents,
      reusablePlugs: { data: {} },
    },
  } as unknown as DestinyProfileResponse;
  const lp = normalizeArmory(legacy, manifest)[0];
  expect(lp.tunedStat).toBeUndefined();
  expect(lp.stats).toEqual([30, 5, 20, 5, 25, 5]);
});

test("a directional tune (with a −5) is reversed in full on the stats it names", () => {
  // Current reflects a +5 weapons / −5 health directional over base [25, 10, 5, 20, 25, 5].
  const cur = {
    [H.weapons]: 30,
    [H.health]: 5,
    [H.class]: 5,
    [H.grenade]: 20,
    [H.super]: 25,
    [H.melee]: 5,
  };
  const DIR = 222;
  const manifest = mkManifest({
    [DIR]: {
      plug: { plugCategoryIdentifier: "armor_tuning" },
      investmentStats: [
        { statTypeHash: H.weapons, value: 5 },
        { statTypeHash: H.health, value: -5 },
      ],
    },
  });
  expect(computeBaseStats("x", mkProfile("x", cur, [DIR]), manifest)).toEqual([
    25, 10, 5, 20, 25, 5,
  ]);
});
