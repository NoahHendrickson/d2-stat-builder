import { test, expect } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { computeBaseStats, itemWatermark, normalizeArmory } from "./normalize";
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
  // No tuning socket and no archetype → legacy piece → +2-all-six masterwork model.
  expect(lp.stats).toEqual([32, 2, 22, 2, 27, 2]);
});

/**
 * Legacy (Armor 2.0) masterwork is +2 to ALL SIX stats (the v460
 * armor.masterworks.stat plugs), not the Armor 3.0 raise-the-3-lowest-to-5 model.
 * Real-world regression: an unmasterworked legacy Verity's Brow normalized to
 * weapons 15 instead of 17, under-reporting the weapon ceiling 145 vs D2AP's 147.
 */
test("legacy piece: assume-masterwork adds +2 to all six stats", () => {
  const ITEM = 888;
  // Unmasterworked legacy Verity's Brow roll (canonical order).
  const cur = {
    [H.weapons]: 15,
    [H.health]: 2,
    [H.class]: 17,
    [H.grenade]: 30,
    [H.super]: 2,
    [H.melee]: 2,
  };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2,
      classType: 2,
      displayProperties: { name: "Verity's Brow" },
      inventory: { bucketTypeHash: 3448274439, tierType: 6 }, // helmet, exotic
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
          v1: {
            stats: Object.fromEntries(
              Object.entries(cur).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: { data: { v1: { sockets: [] } } },
    },
    profileInventory: { data: { items: [{ itemInstanceId: "v1", itemHash: ITEM }] } },
  } as unknown as DestinyProfileResponse;

  const p = normalizeArmory(profile, manifest)[0];
  expect(p.baseStats).toEqual([15, 2, 17, 30, 2, 2]);
  expect(p.stats).toEqual([17, 4, 19, 32, 4, 4]);
});

test("legacy piece already masterworked: the MW plug is stripped, +2 re-applied (no double count)", () => {
  const ITEM = 889;
  const MW_PLUG = 2248916764;
  // Current stats INCLUDE the real +2-all masterwork plug.
  const cur = {
    [H.weapons]: 17,
    [H.health]: 4,
    [H.class]: 19,
    [H.grenade]: 32,
    [H.super]: 4,
    [H.melee]: 4,
  };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2,
      classType: 2,
      displayProperties: { name: "Verity's Brow" },
      inventory: { bucketTypeHash: 3448274439, tierType: 6 },
    },
    [MW_PLUG]: {
      plug: {
        plugCategoryIdentifier: "v460.plugs.armor.masterworks.stat.resistance_3",
      },
      investmentStats: Object.values(H).map((statTypeHash) => ({
        statTypeHash,
        value: 2,
      })),
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
          v2: {
            stats: Object.fromEntries(
              Object.entries(cur).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: { data: { v2: { sockets: [{ plugHash: MW_PLUG }] } } },
    },
    profileInventory: { data: { items: [{ itemInstanceId: "v2", itemHash: ITEM }] } },
  } as unknown as DestinyProfileResponse;

  const p = normalizeArmory(profile, manifest)[0];
  expect(p.baseStats).toEqual([15, 2, 17, 30, 2, 2]);
  expect(p.stats).toEqual([17, 4, 19, 32, 4, 4]);
});

/**
 * Legacy exotics don't carry the "Artifice Armor" intrinsic perk (3727270518) —
 * their artifice capability is the usable enhancements.artifice mod socket
 * (Empty Mod Socket / Forged +3). The locked exotic payment socket
 * (`enhancements.artifice.exotic`) is present on every exotic def and must NOT
 * alone mark a piece as artifice — exotic class items still ship it after
 * losing artifice at Edge of Fate.
 */
test("artifice detection: perk hash OR a usable enhancements.artifice socket", () => {
  const ITEM = 890;
  const EMPTY_ARTIFICE = 4173924323;
  const LOCKED_ARTIFICE = 1656746282;
  const cur = { [H.weapons]: 15 };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2,
      classType: 2,
      displayProperties: { name: "Verity's Brow" },
      inventory: { bucketTypeHash: 3448274439, tierType: 6 },
    },
    [EMPTY_ARTIFICE]: {
      plug: { plugCategoryIdentifier: "enhancements.artifice" },
    },
    [LOCKED_ARTIFICE]: {
      plug: { plugCategoryIdentifier: "enhancements.artifice.exotic" },
    },
  };
  const manifest = {
    def: (_table: string, hash: number | null | undefined) =>
      hash == null ? undefined : defs[hash],
  } as unknown as Manifest;
  const mk = (sockets: { plugHash: number }[]) =>
    ({
      itemComponents: {
        stats: {
          data: {
            a1: {
              stats: Object.fromEntries(
                Object.entries(cur).map(([h, v]) => [h, { value: v }]),
              ),
            },
          },
        },
        sockets: { data: { a1: { sockets } } },
      },
      profileInventory: {
        data: { items: [{ itemInstanceId: "a1", itemHash: ITEM }] },
      },
    }) as unknown as DestinyProfileResponse;

  // The usable artifice mod socket alone marks the piece (legacy exotic shape).
  expect(normalizeArmory(mk([{ plugHash: EMPTY_ARTIFICE }]), manifest)[0].isArtifice).toBe(true);
  // Locked payment socket alone is NOT artifice (exotic class item shape).
  expect(normalizeArmory(mk([{ plugHash: LOCKED_ARTIFICE }]), manifest)[0].isArtifice).toBe(false);
  // No artifice sockets, no perk → false.
  expect(normalizeArmory(mk([]), manifest)[0].isArtifice).toBe(false);
});

test("the archetype plug's name is captured; pieces without one get undefined", () => {
  const ITEM = 777;
  const ARCH_PLUG = 333;
  const cur = {
    [H.weapons]: 30,
    [H.health]: 0,
    [H.class]: 0,
    [H.grenade]: 20,
    [H.super]: 25,
    [H.melee]: 0,
  };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2, // armor
      classType: 0,
      displayProperties: { name: "Collective Psyche Helm" },
      inventory: { bucketTypeHash: 3448274439, tierType: 5 }, // helmet, legendary
    },
    [ARCH_PLUG]: {
      plug: {
        plugCategoryIdentifier:
          "core.gear_systems.armor_tiering.plugs.armor_archetypes",
      },
      displayProperties: { name: "Gunner" },
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
          a1: {
            stats: Object.fromEntries(
              Object.entries(cur).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: { data: { a1: { sockets: [{ plugHash: ARCH_PLUG }] } } },
    },
    profileInventory: {
      data: { items: [{ itemInstanceId: "a1", itemHash: ITEM }] },
    },
  } as unknown as DestinyProfileResponse;

  expect(normalizeArmory(profile, manifest)[0].archetype).toBe("Gunner");

  // A legacy piece with no archetype plug in its sockets → undefined.
  const legacy = {
    ...profile,
    itemComponents: {
      ...(profile as { itemComponents: object }).itemComponents,
      sockets: { data: { a1: { sockets: [] } } },
    },
  } as unknown as DestinyProfileResponse;
  expect(normalizeArmory(legacy, manifest)[0].archetype).toBeUndefined();
});

test("exotic class items capture Spirit perk hashes from sockets 10/11", () => {
  const ITEM = 2273643087; // Solipsism
  const LEFT = 1476923953; // Inmost Light
  const RIGHT = 183430246; // Swarm
  const cur = {
    [H.weapons]: 5,
    [H.health]: 5,
    [H.class]: 5,
    [H.grenade]: 20,
    [H.super]: 30,
    [H.melee]: 25,
  };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2,
      classType: 2,
      displayProperties: { name: "Solipsism" },
      inventory: { bucketTypeHash: 1585787867, tierType: 6 }, // classItem, exotic
    },
  };
  const manifest = {
    def: (_table: string, hash: number | null | undefined) =>
      hash == null ? undefined : defs[hash],
  } as unknown as Manifest;

  // Pad sockets 0–9 empty, then left/right Spirits at 10/11.
  const sockets = Array.from({ length: 12 }, (_, i) => {
    if (i === 10) return { plugHash: LEFT };
    if (i === 11) return { plugHash: RIGHT };
    return {};
  });

  const profile = {
    itemComponents: {
      stats: {
        data: {
          c1: {
            stats: Object.fromEntries(
              Object.entries(cur).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: { data: { c1: { sockets } } },
    },
    profileInventory: {
      data: { items: [{ itemInstanceId: "c1", itemHash: ITEM }] },
    },
  } as unknown as DestinyProfileResponse;

  const piece = normalizeArmory(profile, manifest)[0];
  expect(piece.isExotic).toBe(true);
  expect(piece.slot).toBe("classItem");
  expect(piece.exoticPerkHashes).toEqual([LEFT, RIGHT]);
});

/**
 * Edge of Fate converted exotic class items to Tier-5 Armor 3.0: they have a
 * tuning socket (flexible, like other T5 exotics) and lost artifice. The item
 * def still ships a Locked Artifice Socket (`enhancements.artifice.exotic`) and
 * has no armor_archetypes plug — left Spirit encodes the archetype instead.
 */
test("exotic class items are tunable T5, never artifice, archetype from left Spirit", () => {
  const ITEM = 2273643087; // Solipsism
  const LEFT = 1476923953; // Inmost Light → Super/Melee (Paragon)
  const RIGHT = 183430246; // Swarm
  const EMPTY_TUNING = 2121121504;
  const LOCKED_ARTIFICE = 1656746282;
  const ARCH_PLUG = 4227065942; // Paragon
  const cur = {
    [H.weapons]: 5,
    [H.health]: 5,
    [H.class]: 5,
    [H.grenade]: 20,
    [H.super]: 30,
    [H.melee]: 25,
  };
  const defs: Record<number, object> = {
    [ITEM]: {
      itemType: 2,
      classType: 2,
      displayProperties: { name: "Solipsism" },
      inventory: { bucketTypeHash: 1585787867, tierType: 6 },
    },
    [LEFT]: {
      // Super 30 / Melee 25 — matches ARCHETYPE_PLUG_BY_STATS "4,5" → Paragon.
      investmentStats: [
        { statTypeHash: H.super, value: 30 },
        { statTypeHash: H.melee, value: 25 },
      ],
    },
    [RIGHT]: { investmentStats: [] },
    [EMPTY_TUNING]: {
      plug: {
        plugCategoryIdentifier:
          "core.gear_systems.armor_tiering.plugs.tuning.mods",
      },
    },
    [LOCKED_ARTIFICE]: {
      plug: { plugCategoryIdentifier: "enhancements.artifice.exotic" },
    },
    [ARCH_PLUG]: {
      plug: {
        plugCategoryIdentifier:
          "core.gear_systems.armor_tiering.plugs.armor_archetypes",
      },
      displayProperties: { name: "Paragon" },
    },
  };
  const manifest = {
    def: (_table: string, hash: number | null | undefined) =>
      hash == null ? undefined : defs[hash],
  } as unknown as Manifest;

  // Live shape: tuning at 6, Spirits at 10/11, locked artifice at 14.
  const sockets = Array.from({ length: 16 }, (_, i) => {
    if (i === 6) return { plugHash: EMPTY_TUNING };
    if (i === 10) return { plugHash: LEFT };
    if (i === 11) return { plugHash: RIGHT };
    if (i === 14) return { plugHash: LOCKED_ARTIFICE };
    return {};
  });

  // Flexible exotic tuning plug set (all six +5 directions) — same as other T5 exotics.
  const reusablePlugs = {
    "6": [
      {
        plugItemHash: 388618952, // +Health / -Melee (any directional proves tunable)
      },
      {
        plugItemHash: 4164883102, // +Melee / -Health
      },
    ],
  };
  defs[388618952] = {
    plug: {
      plugCategoryIdentifier:
        "core.gear_systems.armor_tiering.plugs.tuning.mods",
    },
    investmentStats: [
      { statTypeHash: H.health, value: 5 },
      { statTypeHash: H.melee, value: -5 },
    ],
  };
  defs[4164883102] = {
    plug: {
      plugCategoryIdentifier:
        "core.gear_systems.armor_tiering.plugs.tuning.mods",
    },
    investmentStats: [
      { statTypeHash: H.melee, value: 5 },
      { statTypeHash: H.health, value: -5 },
    ],
  };

  const profile = {
    itemComponents: {
      stats: {
        data: {
          c1: {
            stats: Object.fromEntries(
              Object.entries(cur).map(([h, v]) => [h, { value: v }]),
            ),
          },
        },
      },
      sockets: { data: { c1: { sockets } } },
      reusablePlugs: { data: { c1: { plugs: reusablePlugs } } },
    },
    profileInventory: {
      data: { items: [{ itemInstanceId: "c1", itemHash: ITEM }] },
    },
  } as unknown as DestinyProfileResponse;

  const piece = normalizeArmory(profile, manifest)[0];
  expect(piece.isArtifice).toBe(false);
  expect(piece.tunedStat).toBeDefined();
  expect(piece.archetype).toBe("Paragon");
  // Armor 3.0 MW assumption (not legacy +2-all-six): off-arch stay at 5.
  expect(piece.stats).toEqual([5, 5, 5, 20, 30, 25]);

  // Even with no reusablePlugs, the empty tuning socket still marks T5 + tunable.
  const noReusable = {
    ...profile,
    itemComponents: {
      ...(profile as { itemComponents: object }).itemComponents,
      reusablePlugs: undefined,
    },
  } as unknown as DestinyProfileResponse;
  const fallback = normalizeArmory(noReusable, manifest)[0];
  expect(fallback.isArtifice).toBe(false);
  expect(fallback.tunedStat).toBe(0);
  expect(fallback.archetype).toBe("Paragon");
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

test("itemWatermark prefers featured, then the versioned quality icon", () => {
  expect(itemWatermark(undefined)).toBeUndefined();
  expect(
    itemWatermark({
      isFeaturedItem: true,
      iconWatermarkFeatured: "/featured.png",
      iconWatermark: "/season.png",
    }),
  ).toBe("/featured.png");
  expect(
    itemWatermark(
      {
        iconWatermark: "/season.png",
        quality: { currentVersion: 0, displayVersionWatermarkIcons: ["", "/v1.png"] },
      },
      1,
    ),
  ).toBe("/v1.png");
  expect(itemWatermark({ iconWatermark: "/season.png" })).toBe("/season.png");
  expect(itemWatermark({ iconWatermark: "" })).toBeUndefined();
});
