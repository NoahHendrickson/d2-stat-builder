import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";
import { describe, expect, it } from "vitest";

import type { ManifestDefs } from "./manifest";
import {
  buildWeaponMasterworkOptions,
  WEAPON_MASTERWORK_SOCKET_TYPE_HASH,
} from "./weapon-masterwork";

const STABILITY_HASH = 155_624_089;
const RANGE_HASH = 1_240_592_695;
const MAGAZINE_HASH = 3_871_231_066;

function masterworkPlug(
  hash: number,
  name: string,
  statHash: number,
  value: number,
  category = name.replace(/^.*: /, "").toLowerCase(),
): DestinyInventoryItemDefinition {
  return {
    hash,
    displayProperties: { name, icon: `/icons/mw-${statHash}.png` },
    plug: { plugCategoryIdentifier: `v400.plugs.weapons.masterworks.stat.${category}` },
    investmentStats: [{ statTypeHash: statHash, value, isConditionallyActive: false }],
  } as DestinyInventoryItemDefinition;
}

function tierPlug(hash: number, name: string, statHash: number, tier: number) {
  return masterworkPlug(hash, name, statHash, tier);
}

describe("buildWeaponMasterworkOptions", () => {
  const plugSetHash = 9001;
  const items: Record<number, DestinyInventoryItemDefinition> = {
    5001: tierPlug(5001, "Tier 9: Stability", STABILITY_HASH, 9),
    5002: masterworkPlug(5002, "Masterworked: Stability", STABILITY_HASH, 10),
    5003: masterworkPlug(5003, "Masterworked: Range", RANGE_HASH, 10),
    5004: masterworkPlug(5004, "Masterworked: Magazine", MAGAZINE_HASH, 10),
    5005: tierPlug(5005, "Tier 3: Range", RANGE_HASH, 3),
    // The full tier's other version (an adept's, +3 to the rest).
    5006: masterworkPlug(5006, "Masterworked: Stability", STABILITY_HASH, 10),
  };

  const plugSets = {
    [plugSetHash]: {
      reusablePlugItems: [
        { plugItemHash: 5001 },
        { plugItemHash: 5002 },
        { plugItemHash: 5003 },
        { plugItemHash: 5004 },
        { plugItemHash: 5005 },
        { plugItemHash: 5006 },
      ],
    },
  };

  const stats = {
    [STABILITY_HASH]: { displayProperties: { name: "Stability" } },
    [RANGE_HASH]: { displayProperties: { name: "Range" } },
    [MAGAZINE_HASH]: { displayProperties: { name: "Magazine" } },
  } as unknown as ManifestDefs["DestinyStatDefinition"];

  const weapon = {
    hash: 100,
    stats: {
      stats: {
        1: { statHash: STABILITY_HASH, value: 50 },
        2: { statHash: RANGE_HASH, value: 46 },
        3: { statHash: MAGAZINE_HASH, value: 0 },
      },
    },
    sockets: {
      socketEntries: [
        {
          socketTypeHash: WEAPON_MASTERWORK_SOCKET_TYPE_HASH,
          reusablePlugSetHash: plugSetHash,
        },
      ],
    },
  } as unknown as DestinyInventoryItemDefinition;

  // Each option lists its own stat's other plugs, any tier, which copies may hold.
  it("returns completed masterwork options for display stats only", () => {
    const options = buildWeaponMasterworkOptions(
      weapon,
      items,
      plugSets as unknown as ManifestDefs["DestinyPlugSetDefinition"],
      stats,
    );
    expect(options).toEqual([
      {
        plugHash: 5003,
        statHash: RANGE_HASH,
        statName: "Range",
        icon: `/icons/mw-${RANGE_HASH}.png`,
        statMods: [{ hash: RANGE_HASH, value: 10 }],
        tierHashes: [5005],
      },
      {
        plugHash: 5002,
        statHash: STABILITY_HASH,
        statName: "Stability",
        icon: `/icons/mw-${STABILITY_HASH}.png`,
        statMods: [{ hash: STABILITY_HASH, value: 10 }],
        tierHashes: [5001, 5006],
      },
    ]);
  });

  it("counts a crafted copy's enhanced frame as the masterwork in its stat", () => {
    const frame = (hash: number, stat?: number) =>
      ({
        hash,
        displayProperties: { name: "Adaptive Frame" },
        plug: { plugCategoryIdentifier: "intrinsics" },
        investmentStats: stat ? [{ statTypeHash: stat, value: 10, isConditionallyActive: false }] : [],
      }) as unknown as DestinyInventoryItemDefinition;
    const craftable = {
      ...weapon,
      inventory: { recipeItemHash: 700 },
    } as unknown as DestinyInventoryItemDefinition;
    const withRecipe = {
      ...items,
      700: { hash: 700, sockets: { socketEntries: [{ reusablePlugSetHash: 9002 }] } } as unknown as DestinyInventoryItemDefinition,
      // The plain frame adds nothing outright; the enhanced ones add 10 to one stat.
      6000: frame(6000),
      6001: frame(6001, RANGE_HASH),
      6002: frame(6002, STABILITY_HASH),
    };
    const sets = { ...plugSets, 9002: { reusablePlugItems: [{ plugItemHash: 6000 }, { plugItemHash: 6001 }, { plugItemHash: 6002 }] } };
    const options = buildWeaponMasterworkOptions(
      craftable,
      withRecipe,
      sets as unknown as ManifestDefs["DestinyPlugSetDefinition"],
      stats,
    );
    expect(options?.map((o) => [o.statName, o.tierHashes])).toEqual([
      ["Range", [5005, 6001]],
      ["Stability", [5001, 5006, 6002]],
    ]);
  });

  it("returns undefined when the weapon has no masterwork socket", () => {
    const noSocket = {
      ...weapon,
      sockets: { socketEntries: [] },
    } as unknown as DestinyInventoryItemDefinition;
    expect(
      buildWeaponMasterworkOptions(
        noSocket,
        items,
        plugSets as unknown as ManifestDefs["DestinyPlugSetDefinition"],
        stats,
      ),
    ).toBeUndefined();
  });
});
