import { describe, expect, it } from "vitest";
import { sampleWeapons } from "./fixtures/sample-weapons";
import { internWeaponCatalog } from "./intern-weapons";
import { createWeaponCatalog } from "./catalog";
import { compactWeaponIndex, expandWeaponIndex } from "./transport";
import { mergeWeaponFilters } from "./query-language";
import { readSearchState } from "./search-state";

const { index } = internWeaponCatalog(sampleWeapons, "test");

describe("weapon browser integration", () => {
  it("round trips the compact catalog without changing search results", () => {
    const original = createWeaponCatalog(index);
    const compact = compactWeaponIndex(index);
    const restored = createWeaponCatalog(
      expandWeaponIndex(JSON.parse(JSON.stringify(compact))),
    );
    for (const query of [
      "",
      "fatebringer",
      "type:hc",
      'perk:"Firefly"',
      "is:craftable",
      "solar",
      "fatebringr",
    ]) {
      const result = (catalog: ReturnType<typeof createWeaponCatalog>) =>
        catalog
          .search(query, {}, "name")
          .map(({ hash, columns, perks }) => ({ hash, columns, perks }));
      expect(result(restored)).toEqual(result(original));
    }
    expect(JSON.stringify(compact).length).toBeLessThan(
      JSON.stringify(index).length,
    );
  });

  it("combines free text, query syntax, and explicit facets without poisoning cached text", () => {
    const catalog = createWeaponCatalog(index);
    const all = catalog.search("fatebringer", {}, "name");
    expect(all.length).toBeGreaterThan(0);
    expect(
      catalog.search("fatebringer", { element: ["Solar"] }, "name"),
    ).toEqual([]);
    expect(catalog.search("fatebringer", {}, "name")).toEqual(all);
    expect(
      catalog
        .search("type:hc", {}, "name")
        .every((w) => w.type === "Hand Cannon"),
    ).toBe(true);
  });

  it("preserves damage flags and perk combinations when merging filters", () => {
    expect(
      mergeWeaponFilters(
        { element: ["Solar"] },
        {
          trait1DamagePerks: true,
          trait2DamagePerks: false,
          perkCombo: ["Firefly", "Frenzy"],
        },
      ),
    ).toEqual({
      element: ["Solar"],
      trait1DamagePerks: true,
      trait2DamagePerks: false,
      perkCombo: ["Firefly", "Frenzy"],
    });
  });

  it("restores share URLs and safely ignores invalid sort and boolean values", () => {
    const state = readSearchState(
      new URLSearchParams(
        "q=fate&element=Solar&element=Arc&element=Arc&sort=invalid&adept=garbage&trait1DamagePerks=true",
      ),
    );
    expect(state).toEqual({
      query: "fate",
      sort: "season-desc",
      filters: { element: ["Solar", "Arc"], trait1DamagePerks: true },
    });
  });

  it("rejects incompatible or broken catalog data", () => {
    const compact = compactWeaponIndex(index);
    expect(() => expandWeaponIndex({ ...compact, schema: 2 } as never)).toThrow(
      "incomplete",
    );
    expect(() => expandWeaponIndex({ ...compact, perks: [] })).toThrow(
      "invalid perk reference",
    );
  });

  it("restores custom OR groups and ignores malformed shared values", () => {
    const params = new URLSearchParams();
    params.append(
      "group",
      JSON.stringify(["Firefly", "Frenzy", "Firefly", 123]),
    );
    params.append("group", "broken");
    params.append("group", "null");
    expect(readSearchState(params).filters.customPerkGroups).toEqual([
      ["Firefly", "Frenzy"],
    ]);
  });
});
