import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";
import { describe, expect, it } from "vitest";

import {
  buildAmmoTypeCatalog,
  buildColumnPerks,
  deriveAttunementSourceOverrides,
  buildDamageTypeCatalog,
  buildWeaponTypeCatalog,
} from "./build-index";
import type { ManifestDefs } from "./manifest";
import { collectSocketPlugCandidates, plugSetEntryCanRoll } from "./socket-plug-candidates";
function traitPlug(
  hash: number,
  name: string,
  description: string,
  tierType: 2 | 3,
): DestinyInventoryItemDefinition {
  return {
    hash,
    displayProperties: { name, description, icon: "" },
    inventory: { tierType },
    plug: { plugCategoryIdentifier: "frames" },
  } as DestinyInventoryItemDefinition;
}

describe("buildAmmoTypeCatalog", () => {
  it("maps DestinyIconDefinition HUD ammo icons to Primary / Special / Heavy", () => {
    const icons = {
      1: {
        hash: 1,
        foreground: "/common/destiny2_content/icons/30436order_icon_ammo_primary.v2.png",
      },
      2: {
        hash: 2,
        foreground: "/common/destiny2_content/icons/30435order_icon_ammo_special.v2.png",
      },
      3: {
        hash: 3,
        foreground: "/common/destiny2_content/icons/30434order_icon_ammo_heavy.v2.png",
      },
      4: {
        hash: 4,
        redacted: true,
        foreground: "/common/destiny2_content/icons/30434order_icon_ammo_heavy.v2.png",
      },
      5: {
        hash: 5,
        foreground:
          "/common/destiny2_content/icons/25544plugs_armor_mods_head_ammo_drop_special_000_000.v2.png",
      },
    };

    expect(buildAmmoTypeCatalog(icons)).toEqual([
      {
        name: "Primary",
        icon: "/common/destiny2_content/icons/30436order_icon_ammo_primary.v2.png",
      },
      {
        name: "Special",
        icon: "/common/destiny2_content/icons/30435order_icon_ammo_special.v2.png",
      },
      {
        name: "Heavy",
        icon: "/common/destiny2_content/icons/30434order_icon_ammo_heavy.v2.png",
      },
    ]);
  });
});

describe("buildDamageTypeCatalog", () => {
  it("collects display names and icons from DestinyDamageTypeDefinition", () => {
    const defs = {
      DestinyDamageTypeDefinition: {
        1: {
          hash: 1,
          displayProperties: {
            name: "Arc",
            icon: "/common/destiny2_content/icons/arc.png",
          },
        },
        2: {
          hash: 2,
          redacted: true,
          displayProperties: { name: "Hidden", icon: "/hidden.png" },
        },
        3: {
          hash: 3,
          displayProperties: { name: "Solar", icon: "/common/destiny2_content/icons/solar.png" },
        },
      },
    } as unknown as ManifestDefs;

    expect(buildDamageTypeCatalog(defs)).toEqual([
      { hash: 1, name: "Arc", icon: "/common/destiny2_content/icons/arc.png" },
      { hash: 3, name: "Solar", icon: "/common/destiny2_content/icons/solar.png" },
    ]);
  });
});

describe("buildWeaponTypeCatalog", () => {
  it("maps present weapon types to generic Bungie silhouette icons", () => {
    const defs = {
      DestinyInventoryItemDefinition: {
        100: {
          hash: 100,
          itemType: 3,
          itemTypeDisplayName: "Hand Cannon",
          displayProperties: { name: "Better Gun", icon: "/specific-gun.jpg" },
        },
        200: {
          hash: 200,
          itemType: 3,
          itemTypeDisplayName: "Fusion Rifle",
          displayProperties: { name: "Zeta Fusion", icon: "/another-gun.jpg" },
        },
        300: {
          hash: 300,
          itemType: 2,
          itemTypeDisplayName: "Helmet",
          displayProperties: { name: "Helm", icon: "/helm.jpg" },
        },
      },
    } as unknown as ManifestDefs;

    expect(buildWeaponTypeCatalog(defs)).toEqual([
      { name: "Fusion Rifle", icon: "/weapon-types/fusion_rifle.svg" },
      { name: "Hand Cannon", icon: "/weapon-types/hand_cannon.svg" },
    ]);
  });
});

describe("deriveAttunementSourceOverrides", () => {
  it("maps activity attunement vendor items back to their weapon source", () => {
    const defs = {
      DestinyInventoryItemDefinition: {
        69227618: {
          hash: 69227618,
          displayProperties: {
            name: "Cynosure",
            description:
              "Attune to an item to increase its drop chance from this activity. Only one item may be attuned to at a time.",
            iconHash: 2827141087,
          },
        },
        2827141087: {
          hash: 2827141087,
          itemType: 3,
          displayProperties: { name: "Cynosure" },
        },
      },
      DestinyVendorDefinition: {
        1137601706: {
          hash: 1137601706,
          displayProperties: {
            name: "Fireteam Ops Attunement",
            description:
              "Attune to an item to increase its drop chance from this activity. Only one item may be attuned to at a time.",
          },
          itemList: [{ itemHash: 69227618 }],
        },
      },
    } as unknown as ManifestDefs;

    expect(deriveAttunementSourceOverrides(defs)).toEqual(new Map([[2827141087, "Fireteam Ops"]]));
  });
});

describe("plugSetEntryCanRoll", () => {
  it("treats randomized plug-set members as rollable even when Bungie marks them false", () => {
    const socket = { randomizedPlugSetHash: 100, reusablePlugSetHash: 200 };
    expect(plugSetEntryCanRoll(socket, 100, { plugItemHash: 1, currentlyCanRoll: false })).toBe(
      true,
    );
    expect(plugSetEntryCanRoll(socket, 200, { plugItemHash: 1, currentlyCanRoll: false })).toBe(
      false,
    );
    expect(plugSetEntryCanRoll(socket, 200, { plugItemHash: 1, currentlyCanRoll: true })).toBe(
      true,
    );
  });
});

describe("collectSocketPlugCandidates", () => {
  it("OR-merges rollability when the same hash appears more than once", () => {
    const plugSets = {
      10: {
        reusablePlugItems: [
          { plugItemHash: 1, currentlyCanRoll: false },
          { plugItemHash: 1, currentlyCanRoll: true },
        ],
      },
    };
    expect(collectSocketPlugCandidates({ reusablePlugSetHash: 10 }, plugSets)).toEqual([
      { hash: 1, canRoll: true },
    ]);
  });

  it("treats singleInitialItemHash plugs as rollable for display (fixed origin traits)", () => {
    expect(collectSocketPlugCandidates({ singleInitialItemHash: 99 }, {})).toEqual([
      { hash: 99, canRoll: true },
    ]);
  });

  it("merges singleInitialItemHash when a reusable plug set only has an empty crafting socket", () => {
    const plugSets = {
      10: {
        reusablePlugItems: [{ plugItemHash: 1, currentlyCanRoll: true }],
      },
    };
    expect(
      collectSocketPlugCandidates({ reusablePlugSetHash: 10, singleInitialItemHash: 99 }, plugSets),
    ).toEqual([
      { hash: 1, canRoll: true },
      { hash: 99, canRoll: true },
    ]);

    const items: Record<number, DestinyInventoryItemDefinition> = {
      1: {
        hash: 1,
        displayProperties: { name: "Empty Origins Socket", icon: "" },
        plug: { plugCategoryIdentifier: "crafting.recipes.empty_socket" },
      } as DestinyInventoryItemDefinition,
      99: {
        hash: 99,
        displayProperties: { name: "Runneth Over", icon: "" },
        inventory: { tierType: 2 },
        plug: { plugCategoryIdentifier: "origins" },
      } as DestinyInventoryItemDefinition,
    };

    const { perks } = buildColumnPerks(
      collectSocketPlugCandidates({ reusablePlugSetHash: 10, singleInitialItemHash: 99 }, plugSets),
      items,
    );
    expect(perks).toEqual([
      expect.objectContaining({ hash: 99, name: "Runneth Over", currentlyCanRoll: true }),
    ]);
  });
});

describe("buildColumnPerks", () => {
  it("captures base and enhanced descriptions without conflating them", () => {
    const items: Record<number, DestinyInventoryItemDefinition> = {
      1: traitPlug(1, "Rampage", "Kills grant increased damage.", 2),
      2: traitPlug(2, "Rampage", "Kills grant increased damage. Stacks last longer.", 3),
      3: traitPlug(3, "Outlaw", "Precision kills increase reload speed.", 2),
    };

    const { perks } = buildColumnPerks(
      [
        { hash: 1, canRoll: true },
        { hash: 2, canRoll: true },
        { hash: 3, canRoll: true },
      ],
      items,
    );

    expect(perks).toHaveLength(2);

    const rampage = perks.find((perk) => perk.name === "Rampage");
    expect(rampage).toMatchObject({
      hash: 1,
      description: "Kills grant increased damage.",
      enhancedDescription: "Kills grant increased damage. Stacks last longer.",
      alternateHashes: [2],
    });

    const outlaw = perks.find((perk) => perk.name === "Outlaw");
    expect(outlaw).toMatchObject({
      hash: 3,
      description: "Precision kills increase reload speed.",
      enhancedDescription: undefined,
      alternateHashes: undefined,
    });
  });

  it("preserves enhanced metadata when the enhanced plug appears before the base plug", () => {
    const items: Record<number, DestinyInventoryItemDefinition> = {
      10: traitPlug(10, "Frenzy", "While active, this weapon gains bonus damage.", 3),
      11: traitPlug(
        11,
        "Frenzy",
        "While active, this weapon gains bonus damage. Duration increased.",
        2,
      ),
    };

    const { perks } = buildColumnPerks(
      [
        { hash: 10, canRoll: true },
        { hash: 11, canRoll: true },
      ],
      items,
    );

    expect(perks).toEqual([
      {
        hash: 11,
        name: "Frenzy",
        icon: undefined,
        currentlyCanRoll: true,
        description: "While active, this weapon gains bonus damage. Duration increased.",
        enhancedDescription: "While active, this weapon gains bonus damage.",
        alternateHashes: [10],
      },
    ]);
  });

  it("merges canRoll from enhanced-tier plugs when the base plug is marked not rollable", () => {
    const items: Record<number, DestinyInventoryItemDefinition> = {
      10: traitPlug(10, "Outlaw", "Precision kills increase reload speed.", 3),
      11: traitPlug(11, "Outlaw", "Precision kills increase reload speed.", 2),
    };

    const { perks } = buildColumnPerks(
      [
        { hash: 10, canRoll: true },
        { hash: 11, canRoll: false },
      ],
      items,
    );

    expect(perks[0]?.currentlyCanRoll).toBe(true);
  });
});
