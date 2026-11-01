// Every `is:`/`not:`/`key:` filter word swept against the shipped catalog: a filter
// must select exactly what the matching facet chip selects, never fuzzy text matches.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createWeaponCatalog } from "./catalog";
import type { ExcludableFacet, WeaponFilters } from "./search";
import { expandWeaponIndex, type CompactWeaponIndex } from "./transport";

const catalog = createWeaponCatalog(
  expandWeaponIndex(
    JSON.parse(
      readFileSync(join(process.cwd(), "public/data/weapons.json"), "utf8"),
    ) as CompactWeaponIndex,
  ),
);

const hashes = (query: string, filters: WeaponFilters = {}) =>
  catalog
    .search(query, filters, "name").results
    .map((w) => w.hash)
    .sort((a, b) => a - b);
const everything = hashes("");
const without = (kept: number[]) => {
  const out = new Set(kept);
  return everything.filter((h) => !out.has(h));
};
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const values = (facet: string) => catalog.facets[facet]!.map((f) => f.value);

/** The `is:` word for each catalog facet value (slots read as `is:<slot>slot`). */
const IS_WORD: Record<ExcludableFacet, (value: string) => string> = {
  element: squash,
  type: squash,
  ammo: squash,
  rarity: squash,
  slot: (v) => `${squash(v)}slot`,
  champion: squash,
};

describe("weapon search filter words", () => {
  for (const facet of Object.keys(IS_WORD) as ExcludableFacet[]) {
    it(`is:/not:/${facet}: select exactly the ${facet} facet, for every value`, () => {
      expect(values(facet).length).toBeGreaterThan(1);
      for (const value of values(facet)) {
        const expected = hashes("", { [facet]: [value] });
        expect(expected.length, value).toBeGreaterThan(0);
        const word = IS_WORD[facet](value);
        expect(hashes(`is:${word}`), `is:${word}`).toEqual(expected);
        expect(hashes(`IS:${word.toUpperCase()}`), `IS:${word}`).toEqual(expected);
        expect(hashes(`${facet}:"${value}"`), `${facet}:"${value}"`).toEqual(expected);
        if (facet !== "champion") {
          // A weapon stuns one champion at most, so only one-valued facets complement exactly.
          expect(hashes(`not:${word}`), `not:${word}`).toEqual(without(expected));
        }
      }
    });
  }

  it("not:<champion> drops every weapon that stuns it", () => {
    const barrier = new Set(hashes("is:barrier"));
    const rest = hashes("not:barrier");
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.some((h) => barrier.has(h))).toBe(false);
  });

  it("is:arc keeps no Strand or Kinetic bow (Vengeful Whisper, Whispering Slab)", () => {
    const names = new Set(catalog.search("is:arc", {}, "name").results.map((w) => w.name));
    expect(names.has("Vengeful Whisper")).toBe(false);
    expect(names.has("Whispering Slab")).toBe(false);
    expect(catalog.search("is:arc", {}, "name").results.every((w) => w.element === "Arc")).toBe(true);
  });

  it("weapon-type shorthands and squashed names match the type", () => {
    const handCannons = hashes("", { type: ["Hand Cannon"] });
    for (const q of ["is:hc", "is:handcannon", "type:hc", "type:handcannon", 'type:"hand cannon"']) {
      expect(hashes(q), q).toEqual(handCannons);
    }
    const bows = hashes("", { type: ["Combat Bow"] });
    for (const q of ["is:bow", "type:bow", "is:combatbow"]) expect(hashes(q), q).toEqual(bows);
    const lfrs = hashes("", { type: ["Linear Fusion Rifle"] });
    expect(hashes("is:lfr")).toEqual(lfrs);
    expect(hashes("is:smg")).toEqual(hashes("", { type: ["Submachine Gun"] }));
  });

  it("is:light / is:dark cover their elements", () => {
    expect(hashes("is:light")).toEqual(hashes("", { element: ["Arc", "Solar", "Void"] }));
    expect(hashes("is:dark")).toEqual(hashes("", { element: ["Stasis", "Strand"] }));
  });

  it("grenade launchers by ammo combine and negate like any other type", () => {
    const heavyGls = hashes("", { type: ["Grenade Launcher"], ammo: ["Heavy"] });
    const specialGls = hashes("", { type: ["Grenade Launcher"], ammo: ["Special"] });
    expect(heavyGls.length).toBeGreaterThan(0);
    expect(hashes("is:heavygrenadelauncher")).toEqual(heavyGls);
    expect(hashes("not:heavygrenadelauncher")).toEqual(without(heavyGls));
    const shotguns = hashes("", { type: ["Shotgun"] });
    expect(hashes("is:shotgun is:heavygrenadelauncher")).toEqual(
      [...shotguns, ...heavyGls].sort((a, b) => a - b),
    );
    // Primary-ammo launchers (Fighting Lion) stay: only Special ones are ruled out.
    expect(specialGls.length).toBeGreaterThan(0);
    const special = new Set(specialGls);
    expect(hashes("is:grenadelauncher not:specialgrenadelauncher")).toEqual(
      hashes("", { type: ["Grenade Launcher"] }).filter((h) => !special.has(h)),
    );
  });

  it("odd inputs never throw", () => {
    for (const q of ["is:constructor", "not:constructor", "is:__proto__", "constructor:x", "type:__proto__"]) {
      expect(() => catalog.search(q, {}, "name"), q).not.toThrow();
      expect(catalog.search(q, {}, "name").unknown.map((u) => u.token), q).toEqual([q]);
    }
  });

  it("a quoted perk name with a colon searches as text", () => {
    const result = catalog.search('"Property: Undecidable"', {}, "name");
    expect(result.unknown).toEqual([]);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("filter words combine: across kinds AND, within a kind OR, not: excludes", () => {
    expect(hashes("is:arc is:heavy")).toEqual(hashes("", { element: ["Arc"], ammo: ["Heavy"] }));
    expect(hashes("is:arc is:solar")).toEqual(hashes("", { element: ["Arc", "Solar"] }));
    expect(hashes("is:arc not:exotic")).toEqual(
      hashes("", { element: ["Arc"], rarity: ["Legendary", "Rare", "Uncommon", "Common"] }),
    );
  });

  it("not: still applies with a chip filter on the same facet", () => {
    expect(hashes("not:arc", { element: ["Arc", "Solar"] })).toEqual(
      hashes("", { element: ["Solar"] }),
    );
  });

  it("unknown filters match nothing instead of fuzzy text", () => {
    for (const q of [
      "is:arcc",
      "is:crafted",
      "elemnt:arc",
      "type:blaster",
      "craftable:maybe",
      "fatebringer is:nope",
    ]) {
      expect(hashes(q), q).toEqual([]);
    }
  });

  it("an unfinished key narrows nothing", () => {
    expect(hashes("is:")).toEqual(everything);
    expect(hashes("is:arc not:")).toEqual(hashes("is:arc"));
  });
});

describe("a filter word typed alone", () => {
  const leads = (query: string, filters: WeaponFilters, sort: "name" | "season-desc" = "name") => {
    const results = catalog.search(query, {}, sort).results;
    const group = catalog.search("", filters, sort).results;
    expect(results.slice(0, group.length).map((w) => w.hash), query).toEqual(
      group.map((w) => w.hash),
    );
    return results.slice(group.length);
  };

  it("arc: every Arc weapon first, then name and typo matches", () => {
    const after = leads("arc", { element: ["Arc"] });
    const names = after.map((w) => w.name);
    expect(names).toContain("Archon's Thunder");
    expect(names).toContain("Marcato-45");
    expect(after.every((w) => w.element !== "Arc")).toBe(true);
    // Real substring matches before typo matches.
    const firstTypo = names.findIndex((n) => !n.toLowerCase().includes("arc"));
    const lastName = names.findLastIndex((n) => n.toLowerCase().includes("arc"));
    expect(firstTypo === -1 || lastName < firstTypo).toBe(true);
  });

  it("the leading group follows the chosen sort", () => {
    leads("arc", { element: ["Arc"] }, "season-desc");
  });

  it("works for ammo, rarity, and weapon types, shorthands included", () => {
    leads("heavy", { ammo: ["Heavy"] });
    leads("exotic", { rarity: ["Exotic"] });
    leads("smg", { type: ["Submachine Gun"] });
    leads("hc", { type: ["Hand Cannon"] });
    leads("hand cannon", { type: ["Hand Cannon"] });
  });

  it("chips still narrow it", () => {
    const results = catalog.search("arc", { type: ["Hand Cannon"] }, "name").results;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((w) => w.type === "Hand Cannon")).toBe(true);
    expect(results[0]!.element).toBe("Arc");
  });

  it("words that mean something else alone stay text", () => {
    const light = catalog.search("light", {}, "name").results;
    expect(light.length).toBeLessThan(hashes("is:light").length);
  });
});
