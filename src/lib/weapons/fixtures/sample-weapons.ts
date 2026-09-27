import type { PerkRef, WeaponDoc } from "../types";
import { SAMPLE_STAT_GROUP_HASH } from "../weapon-stats";

const p = (
  hash: number,
  name: string,
  currentlyCanRoll = true,
  extra?: Pick<PerkRef, "description" | "enhancedDescription" | "alternateHashes" | "statMods">,
): PerkRef => ({
  hash,
  name,
  currentlyCanRoll,
  ...extra,
});

/**
 * A tiny, deterministic dataset used by unit tests (and as a dev fallback).
 * Real data is generated from the live manifest via `pnpm --filter @repo/destiny generate`.
 */
export const sampleWeapons: WeaponDoc[] = [
  {
    hash: 1,
    name: "Fatebringer",
    type: "Hand Cannon",
    element: "Arc",
    ammo: "Primary",
    rarity: "Legendary",
    slot: "Kinetic",
    frame: "Adaptive Frame",
    craftable: true,
    adept: false,
    seasonNumber: 14,
    seasonName: "Season of the Splicer",
    source: "Vault of Glass",
    releaseIndex: 100,
    statGroupHash: SAMPLE_STAT_GROUP_HASH,
    stats: [
      { hash: 1, name: "Impact", value: 84 },
      { hash: 2, name: "Range", value: 46 },
      { hash: 3, name: "Stability", value: 50 },
      { hash: 4, name: "Handling", value: 30 },
    ],
    investmentStats: [
      { hash: 1, name: "Impact", value: 84 },
      { hash: 2, name: "Range", value: 46 },
      { hash: 3, name: "Stability", value: 50 },
      { hash: 4, name: "Handling", value: 30 },
    ],
    masterworkOptions: [
      {
        statHash: 2,
        statName: "Range",
        icon: "/common/destiny2_content/icons/mw-range.png",
        statMods: [{ hash: 2, value: 10 }],
      },
      {
        statHash: 3,
        statName: "Stability",
        icon: "/common/destiny2_content/icons/mw-stability.png",
        statMods: [{ hash: 3, value: 10 }],
      },
    ],
    columns: [
      { kind: "Intrinsic", perks: [p(100, "Adaptive Frame", false)] },
      {
        kind: "Barrel",
        perks: [
          p(101, "Fluted Barrel", true, { statMods: [{ hash: 4, value: 20 }, { hash: 2, value: -5 }] }),
          p(102, "Corkscrew Rifling", true, {
            statMods: [{ hash: 2, value: 10 }, { hash: 3, value: 10 }],
          }),
        ],
      },
      {
        kind: "Magazine",
        perks: [
          p(103, "Accurized Rounds", true, { statMods: [{ hash: 2, value: 10 }] }),
          p(104, "Tactical Mag", true, { statMods: [{ hash: 3, value: 10 }, { hash: 4, value: 10 }] }),
        ],
      },
      {
        kind: "Trait",
        perks: [
          p(105, "Explosive Payload"),
          p(106, "Firefly", true, {
            description: "Precision kills cause target to explode.",
            enhancedDescription: "Precision kills cause target to explode. Explosion radius is increased.",
            alternateHashes: [1061],
          }),
          p(110, "Surrounded", true, {
            description: "This weapon gains bonus damage when surrounded by foes.",
            enhancedDescription:
              "This weapon gains bonus damage when surrounded by foes. Bonus damage is increased.",
            alternateHashes: [1101],
          }),
        ],
      },
      { kind: "Trait", perks: [p(107, "Frenzy"), p(108, "Eye of the Storm")] },
      { kind: "Origin Trait", perks: [p(109, "Vault of Glass")] },
    ],
    perks: [
      "Adaptive Frame",
      "Fluted Barrel",
      "Corkscrew Rifling",
      "Accurized Rounds",
      "Tactical Mag",
      "Explosive Payload",
      "Firefly",
      "Surrounded",
      "Frenzy",
      "Eye of the Storm",
      "Vault of Glass",
    ],
    perkHashes: [100, 101, 102, 103, 104, 105, 106, 110, 107, 108, 109],
  },
  {
    hash: 2,
    name: "Sunlit Fusion",
    type: "Fusion Rifle",
    element: "Solar",
    ammo: "Special",
    rarity: "Legendary",
    slot: "Energy",
    frame: "Adaptive Frame",
    craftable: false,
    adept: false,
    source: "Solstice",
    releaseIndex: 50,
    stats: [{ hash: 3, name: "Charge Time", value: 660 }],
    columns: [
      { kind: "Intrinsic", perks: [p(200, "Adaptive Frame", false)] },
      { kind: "Battery", perks: [p(201, "Projection Fuse"), p(202, "Ionized Battery")] },
      { kind: "Trait", perks: [p(203, "Surrounded"), p(204, "Reservoir Burst")] },
    ],
    perks: ["Adaptive Frame", "Projection Fuse", "Ionized Battery", "Surrounded", "Reservoir Burst"],
    perkHashes: [200, 201, 202, 203, 204],
  },
  {
    hash: 3,
    name: "Stormcharge",
    type: "Fusion Rifle",
    element: "Arc",
    ammo: "Special",
    rarity: "Legendary",
    slot: "Energy",
    frame: "Rapid-Fire Frame",
    craftable: true,
    adept: false,
    seasonNumber: 23,
    seasonName: "Season of the Wish",
    source: "Root of Nightmares",
    releaseIndex: 200,
    stats: [{ hash: 3, name: "Charge Time", value: 500 }],
    columns: [
      { kind: "Intrinsic", perks: [p(300, "Rapid-Fire Frame", false)] },
      { kind: "Trait", perks: [p(301, "Liquid Coils"), p(302, "Chill Clip")] },
    ],
    perks: ["Rapid-Fire Frame", "Liquid Coils", "Chill Clip"],
    perkHashes: [300, 301, 302],
  },
  {
    hash: 4,
    name: "Sunshot Scout",
    type: "Scout Rifle",
    element: "Solar",
    ammo: "Primary",
    rarity: "Legendary",
    slot: "Kinetic",
    frame: "Lightweight Frame",
    craftable: false,
    adept: false,
    source: "World Loot Pool",
    releaseIndex: 80,
    stats: [{ hash: 1, name: "Impact", value: 62 }],
    columns: [
      { kind: "Intrinsic", perks: [p(400, "Lightweight Frame", false)] },
      { kind: "Trait", perks: [p(401, "Firefly"), p(402, "Explosive Payload")] },
    ],
    perks: ["Lightweight Frame", "Firefly", "Explosive Payload"],
    perkHashes: [400, 401, 402],
  },
];
