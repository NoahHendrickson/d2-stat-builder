import { describe, expect, test } from "vitest";

import { sampleWeapons } from "./fixtures/sample-weapons";
import { internWeaponCatalog } from "./intern-weapons";
import { mergeWeaponFilters, parseWeaponQuery, planWeaponTextSearch } from "./query-language";
import { filterWeapons, type WeaponFilters } from "./search";

describe("parseWeaponQuery", () => {
  test("plain text passes through with no filters", () => {
    expect(parseWeaponQuery("fatebringer")).toEqual({ filters: {}, text: "fatebringer" });
  });

  test("facet keywords map onto OR-within arrays", () => {
    const { filters, text } = parseWeaponQuery('element:solar type:"hand cannon" ammo:special');
    expect(filters.element).toEqual(["solar"]);
    expect(filters.ammo).toEqual(["special"]);
    expect(filters.type).toEqual(["hand cannon"]);
    expect(text).toBe("");
  });

  test("type alias expansion (hc → hand cannon)", () => {
    const { filters } = parseWeaponQuery("type:hc");
    expect(filters.type).toEqual(["hand cannon"]);
  });

  test("quoted multi-word values stay intact", () => {
    const { filters } = parseWeaponQuery('perk:"kill clip" trait1:"frenzy"');
    expect(filters.perks).toEqual(["kill clip"]);
    expect(filters.trait1).toEqual(["frenzy"]);
  });

  test("trait keyword maps to the generic trait filter", () => {
    const { filters } = parseWeaponQuery('trait:"destabilizing rounds" trait2:frenzy');
    expect(filters.trait).toEqual(["destabilizing rounds"]);
    expect(filters.trait2).toEqual(["frenzy"]);
  });

  test("is: flags set adept, craftable, and rarity", () => {
    expect(parseWeaponQuery("is:adept").filters.adept).toBe(true);
    expect(parseWeaponQuery("not:adept").filters.adept).toBe(false);
    expect(parseWeaponQuery("is:craftable").filters.craftable).toEqual(["Yes"]);
    expect(parseWeaponQuery("is:exotic").filters.rarity).toEqual(["exotic"]);
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
    expect(filters.element).toEqual(["solar", "arc"]);
  });

  test("unknown keys fall through to free text", () => {
    const { filters, text } = parseWeaponQuery("foo:bar baz");
    expect(filters).toEqual({});
    expect(text).toBe("foo:bar baz");
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

describe("planWeaponTextSearch", () => {
  test("free text becomes the search text", () => {
    expect(planWeaponTextSearch("fatebringer")).toEqual({
      filters: {},
      searchText: "fatebringer",
    });
  });

  test("text + keyword splits into searchText and filters", () => {
    const plan = planWeaponTextSearch("fate element:solar");
    expect(plan.searchText).toBe("fate");
    expect(plan.filters.element).toEqual(["solar"]);
  });

  test("keyword-only query yields empty searchText (filter the full catalog)", () => {
    const plan = planWeaponTextSearch("is:adept element:arc");
    expect(plan.searchText).toBe("");
    expect(plan.filters.adept).toBe(true);
    expect(plan.filters.element).toEqual(["arc"]);
  });

  test("sub-threshold text with no keywords falls back to the raw input", () => {
    expect(planWeaponTextSearch("a").searchText).toBe("a");
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
