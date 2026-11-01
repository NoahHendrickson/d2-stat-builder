import { describe, expect, test } from "vitest";

import { sampleWeapons } from "./fixtures/sample-weapons";
import { internWeaponCatalog } from "./intern-weapons";
import { mergeWeaponFilters, parseWeaponQuery as parse, weaponQueryVocabulary } from "./query-language";
import { filterWeapons, type WeaponFilters } from "./search";

const vocabulary = weaponQueryVocabulary({
  types: ["Auto Rifle", "Combat Bow", "Grenade Launcher", "Hand Cannon", "Linear Fusion Rifle", "Shotgun"],
  elements: ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand"],
});
const parseWeaponQuery = (input: string) => parse(input, vocabulary);
const notAFilter = (token: string) => ({ token, reason: "isn't a search filter" });

describe("parseWeaponQuery", () => {
  test("plain text passes through with no filters", () => {
    expect(parseWeaponQuery("fatebringer")).toEqual({ filters: {}, text: "fatebringer", unknown: [] });
    expect(parseWeaponQuery("  fate   bringer ").text).toBe("fate bringer");
  });

  test("facet keywords map onto OR-within arrays, by their catalog names", () => {
    const { filters, text } = parseWeaponQuery('element:solar type:"hand cannon" ammo:special');
    expect(filters.element).toEqual(["Solar"]);
    expect(filters.ammo).toEqual(["Special"]);
    expect(filters.type).toEqual(["Hand Cannon"]);
    expect(text).toBe("");
  });

  test("type alias expansion (hc → hand cannon)", () => {
    expect(parseWeaponQuery("type:hc").filters.type).toEqual(["Hand Cannon"]);
    expect(parseWeaponQuery("type:handcannon").filters.type).toEqual(["Hand Cannon"]);
    expect(parseWeaponQuery("type:bow").filters.type).toEqual(["Combat Bow"]);
  });

  test("quoted multi-word values stay intact", () => {
    const { filters } = parseWeaponQuery('perk:"kill clip" trait1:"frenzy"');
    expect(filters.perks).toEqual(["kill clip"]);
    expect(filters.trait1).toEqual(["frenzy"]);
  });

  test("trait keyword maps to the generic trait filter", () => {
    const { filters } = parseWeaponQuery('trait:"destabilizing rounds" trait2:frenzy origin:veist name:x');
    expect(filters.trait).toEqual(["destabilizing rounds"]);
    expect(filters.trait2).toEqual(["frenzy"]);
    expect(filters.originTrait).toEqual(["veist"]);
    expect(filters.name).toEqual(["x"]);
  });

  test("is: flags set adept, craftable, and rarity", () => {
    expect(parseWeaponQuery("is:adept").filters.adept).toBe(true);
    expect(parseWeaponQuery("not:adept").filters.adept).toBe(false);
    expect(parseWeaponQuery("is:craftable").filters.craftable).toEqual(["Yes"]);
    expect(parseWeaponQuery("is:exotic").filters.rarity).toEqual(["Exotic"]);
  });

  test("is: words select elements, ammo, slots, champions, and weapon types", () => {
    expect(parseWeaponQuery("is:arc").filters).toEqual({ element: ["Arc"] });
    expect(parseWeaponQuery("is:arc").text).toBe("");
    expect(parseWeaponQuery("is:heavy").filters).toEqual({ ammo: ["Heavy"] });
    expect(parseWeaponQuery("is:kineticslot").filters).toEqual({ slot: ["Kinetic"] });
    expect(parseWeaponQuery("is:antibarrier").filters).toEqual({ champion: ["Barrier"] });
    expect(parseWeaponQuery("is:lfr").filters).toEqual({ type: ["Linear Fusion Rifle"] });
    expect(parseWeaponQuery("is:light").filters).toEqual({ element: ["Arc", "Solar", "Void"] });
  });

  test("not: words exclude", () => {
    expect(parseWeaponQuery("not:arc not:exotic").filters).toEqual({
      exclude: { element: ["Arc"], rarity: ["Exotic"] },
    });
  });

  test("grenade launchers by ammo are one type value, so they OR with other types and negate", () => {
    expect(parseWeaponQuery("is:shotgun is:heavygrenadelauncher").filters).toEqual({
      type: ["Shotgun", "Heavy Grenade Launcher"],
    });
    expect(parseWeaponQuery("not:specialgrenadelauncher").filters).toEqual({
      exclude: { type: ["Special Grenade Launcher"] },
    });
    expect(parseWeaponQuery('type:"heavy grenade launcher"').filters.type).toEqual(["Heavy Grenade Launcher"]);
  });

  test("craftable:yes/no normalizes", () => {
    expect(parseWeaponQuery("craftable:yes").filters.craftable).toEqual(["Yes"]);
    expect(parseWeaponQuery("craftable:no").filters.craftable).toEqual(["No"]);
  });

  test("source and season keywords map onto facets", () => {
    const { filters, text } = parseWeaponQuery('source:"Root of Nightmares" season:23');
    expect(filters.source).toEqual(["Root of Nightmares"]);
    expect(filters.season).toEqual(["23"]);
    expect(text).toBe("");
  });

  test("repeated facet keys accumulate (OR within)", () => {
    const { filters } = parseWeaponQuery("element:solar element:arc");
    expect(filters.element).toEqual(["Solar", "Arc"]);
  });

  test("unknown filters are reported with why, never searched as text", () => {
    expect(parseWeaponQuery("foo:bar is:arcc type:blaster craftable:maybe baz")).toEqual({
      filters: {},
      text: "baz",
      unknown: [
        notAFilter("foo:bar"),
        notAFilter("is:arcc"),
        { token: "type:blaster", reason: "isn't a weapon type" },
        { token: "craftable:maybe", reason: "takes yes or no" },
      ],
    });
  });

  test("inherited object keys are unknown, not lookups", () => {
    for (const token of ["is:constructor", "not:__proto__", "is:tostring", "constructor:x", "slot:constructor"]) {
      expect(() => parseWeaponQuery(token), token).not.toThrow();
      const parsed = parseWeaponQuery(token);
      expect(parsed.filters, token).toEqual({});
      expect(parsed.unknown.map((u) => u.token), token).toEqual([token]);
    }
  });

  test("a bare known key is ignored while typing; an unknown one stays text", () => {
    expect(parseWeaponQuery("is: perk:")).toEqual({ filters: {}, text: "", unknown: [] });
    expect(parseWeaponQuery("Property: Undecidable").text).toBe("Property: Undecidable");
  });

  test("a quoted perk name with a colon in it is text", () => {
    for (const name of ["Property: Undecidable", "SUBROUTINE: ~RECURSION", "Marksman Optics: Low"]) {
      expect(parseWeaponQuery(`"${name}"`), name).toEqual({ filters: {}, text: name, unknown: [] });
    }
  });

  test("one descriptive word alone is a keyword; words that read as something else aren't", () => {
    expect(parseWeaponQuery("arc").keyword).toEqual({ element: ["Arc"] });
    expect(parseWeaponQuery("hc").keyword).toEqual({ type: ["Hand Cannon"] });
    expect(parseWeaponQuery("hand cannon").keyword).toEqual({ type: ["Hand Cannon"] });
    expect(parseWeaponQuery("is:solar arc").keyword).toEqual({ element: ["Arc"] });
    for (const text of ["light", "power", "stagger", "heavygrenadelauncher", "arc warden", "fatebringer"]) {
      expect(parseWeaponQuery(text).keyword, text).toBeUndefined();
    }
  });

  test("parsed element filter drives filterWeapons against the sample catalog", () => {
    const { index } = internWeaponCatalog(sampleWeapons, "sample");
    const weapons = index.weapons;
    const { filters } = parseWeaponQuery("element:solar");
    const byElement = filterWeapons(weapons, { element: filters.element }, index.perks);
    expect(byElement.length).toBeGreaterThan(0);
    expect(byElement.every((w) => w.element.toLowerCase() === "solar")).toBe(true);
  });

  test("adept filter keeps only adept weapons", () => {
    const { index } = internWeaponCatalog(sampleWeapons, "sample");
    const weapons = index.weapons;
    const { filters } = parseWeaponQuery("is:adept");
    const adeptOnly = filterWeapons(weapons, filters, index.perks);
    expect(adeptOnly.every((w) => w.adept)).toBe(true);
  });

  test("parsed source and season filters drive sample catalog filtering", () => {
    const { index } = internWeaponCatalog(sampleWeapons, "sample");
    const { filters } = parseWeaponQuery('source:"Root of Nightmares" season:23');
    expect(filterWeapons(index.weapons, filters, index.perks).map((w) => w.name)).toEqual([
      "Stormcharge",
    ]);
  });
});

describe("mergeWeaponFilters", () => {
  test("returns base unchanged when extra is empty", () => {
    const base: WeaponFilters = { element: ["solar"] };
    expect(mergeWeaponFilters(base, {})).toBe(base);
  });

  test("OR-merges facet arrays case-insensitively without duplicates", () => {
    const merged = mergeWeaponFilters(
      { element: ["Solar"], source: ["Root of Nightmares"], trait: ["Frenzy"] },
      { element: ["solar", "arc"], season: ["23"], trait: ["frenzy", "Surrounded"] },
    );
    expect(merged.element).toEqual(["Solar", "arc"]);
    expect(merged.source).toEqual(["Root of Nightmares"]);
    expect(merged.season).toEqual(["23"]);
    expect(merged.trait).toEqual(["Frenzy", "Surrounded"]);
  });

  test("extra adept flag overrides; custom groups concatenate", () => {
    const merged = mergeWeaponFilters(
      { customPerkGroups: [["a"]] },
      { adept: true, customPerkGroups: [["b"]] },
    );
    expect(merged.adept).toBe(true);
    expect(merged.customPerkGroups).toEqual([["a"], ["b"]]);
  });

  test("does not mutate the base filter object", () => {
    const base: WeaponFilters = { element: ["solar"] };
    mergeWeaponFilters(base, { element: ["arc"] });
    expect(base.element).toEqual(["solar"]);
  });
});
