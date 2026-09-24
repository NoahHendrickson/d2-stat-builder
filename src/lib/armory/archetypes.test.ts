import { describe, expect, it } from "vitest";
import { getArchetypes, parseArchetypeDescription } from "./archetypes";
import type { Manifest } from "../manifest/load";

describe("parseArchetypeDescription", () => {
  it("reads the live plug description format", () => {
    expect(
      parseArchetypeDescription(
        "Armor configured for Guardians who take a weapon-centric approach.\n\nPrimary Stat: Weapons\nSecondary Stat: Grenade",
      ),
    ).toEqual({ primary: 0, secondary: 3 });
  });

  it("rejects descriptions without both stats", () => {
    expect(parseArchetypeDescription("Primary Stat: Weapons")).toBeNull();
    expect(parseArchetypeDescription("Primary Stat: Luck\nSecondary Stat: Grenade")).toBeNull();
  });
});

describe("getArchetypes", () => {
  it("collects archetype plugs once per name, sorted", () => {
    const plug = (name: string, description: string, redacted = false) => ({
      displayProperties: { name, description },
      plug: { plugCategoryIdentifier: "armor_archetypes" },
      redacted,
    });
    const items: Record<number, unknown> = {
      1: plug("Paragon", "Primary Stat: Super\nSecondary Stat: Melee"),
      2: plug("Brawler", "Primary Stat: Melee\nSecondary Stat: Health"),
      3: plug("Brawler", "Primary Stat: Melee\nSecondary Stat: Health"),
      4: plug("Ghost", "Primary Stat: Weapons\nSecondary Stat: Class", true),
      5: { displayProperties: { name: "Not a plug", description: "" } },
    };
    const manifest = { all: () => items } as unknown as Manifest;
    expect(getArchetypes(manifest)).toEqual([
      { name: "Brawler", primary: 5, secondary: 1 },
      { name: "Paragon", primary: 4, secondary: 5 },
    ]);
  });
});
