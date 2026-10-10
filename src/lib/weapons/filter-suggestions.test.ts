import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  buildFilterIndex,
  categoryValues,
  matchingCategories,
  pendingPairValue,
  suggestFilters,
  withFilter,
  withoutFilter,
} from "./filter-suggestions";
import { readSearchState } from "./search-state";

const index = buildFilterIndex({
  element: [
    { value: "Solar", count: 300 },
    { value: "Arc", count: 280 },
  ],
  type: [
    { value: "Hand Cannon", count: 120 },
    { value: "Auto Rifle", count: 110 },
  ],
  trait: [{ value: "Kill Clip", count: 130 }],
  trait1: [{ value: "Kill Clip", count: 40 }],
  trait2: [{ value: "Kill Clip", count: 90 }],
  frame: [
    { value: "Aggressive Frame", count: 80 },
    { value: "High-Impact Frame", count: 60 },
  ],
  source: [{ value: "Solar Wind Strike", count: 0 }],
  gear: [{ value: "Sticky Grenades", count: 10 }],
  champion: [{ value: "Overload", count: 8 }],
});

const labels = (query: string, params = new URLSearchParams()) =>
  suggestFilters(index, query, params).map(
    ({ category, value }) => `${category.label}: ${value.label}`,
  );

describe("suggestFilters", () => {
  it("puts exact facet matches first and lets sources match mid-name", () => {
    expect(labels("solar")).toEqual([
      "Element: Solar",
      "Source: Solar Wind Strike",
    ]);
  });

  it("offers a perk once per perk category, either-column trait first", () => {
    expect(labels("kill")).toEqual([
      "Trait: Kill Clip",
      "Trait 1: Kill Clip",
      "Trait 2: Kill Clip",
    ]);
  });

  it("finds barrel/mag perks and champions by name", () => {
    expect(labels("sticky")).toEqual(["Barrel / Mag: Sticky Grenades"]);
    expect(labels("overload")).toEqual(["Champion: Overload"]);
  });

  it("expands shorthand like hc", () => {
    expect(labels("hc")).toEqual(["Weapon type: Hand Cannon"]);
  });

  it("only suggests frames the query starts", () => {
    expect(labels("impact")).toEqual([]);
    expect(labels("high")).toEqual(["Frame: High-Impact Frame"]);
  });

  it("skips values already applied", () => {
    expect(labels("solar", new URLSearchParams("element=Solar"))).toEqual([
      "Source: Solar Wind Strike",
    ]);
  });

  it("finds damage perks and adept by name", () => {
    expect(labels("damage")).toEqual([
      "Trait 1: Damage perks",
      "Trait 2: Damage perks",
    ]);
    expect(labels("adept")).toEqual(["Adept: Adept"]);
  });

  it("reads an ammo gen bound from its name then a number", () => {
    expect(labels("ammo gen 50")).toEqual(["Ammo gen: > 50"]);
    expect(labels("ammo generation > 40")).toEqual(["Ammo gen: > 40"]);
    expect(labels("ammo>40")).toEqual(["Ammo gen: > 40"]);
    expect(labels("ammo gen 50", new URLSearchParams("ammoGen=50"))).toEqual(
      [],
    );
    expect(labels("hc 50")).toEqual([]);
  });
});

describe("matchingCategories", () => {
  it("lists every category for an empty query and filters by name", () => {
    expect(matchingCategories(index, "").length).toBe(index.length);
    expect(
      matchingCategories(index, "fra").map((e) => e.category.label),
    ).toEqual(["Frame"]);
  });

  it("matches categories by alias", () => {
    expect(
      matchingCategories(index, "archetype").map((e) => e.category.label),
    ).toEqual(["Frame"]);
    expect(
      matchingCategories(index, "magazine").map((e) => e.category.label),
    ).toEqual(["Barrel / Mag"]);
  });
});

describe("categoryValues", () => {
  it("narrows one category and caps what renders", () => {
    const frame = index.find((e) => e.category.param === "frame")!;
    expect(
      categoryValues(frame, "impact", new URLSearchParams()).values.map(
        (v) => v.label,
      ),
    ).toEqual(["High-Impact Frame"]);
    expect(categoryValues(frame, "", new URLSearchParams(), 1)).toMatchObject({
      hidden: 1,
    });
  });

  it("turns a typed number into the ammo gen bound", () => {
    const ammoGen = index.find((e) => e.category.param === "ammoGen")!;
    const bound = (text: string) =>
      categoryValues(ammoGen, text, new URLSearchParams()).values.map(
        (v) => `${v.param}=${v.value}`,
      );
    expect(bound("")).toEqual([]);
    expect(bound("fast")).toEqual([]);
    expect(bound("35")).toEqual(["ammoGen=35"]);
    expect(bound("> 35")).toEqual(["ammoGen=35"]);
  });
});

describe("withFilter / withoutFilter", () => {
  it("adds a value, clears the typed text, and keeps the newest when capped", () => {
    const arc = { param: "element", value: "Arc", label: "Arc" };
    const next = withFilter(
      new URLSearchParams("q=a&element=Solar&element=Void"),
      arc,
      { max: 2 },
    );
    expect(next.toString()).toBe("element=Void&element=Arc");
  });

  it("ignores an ammo gen param that isn't a whole number", () => {
    expect(
      readSearchState(new URLSearchParams("ammoGen=lots")).filters,
    ).toEqual({});
    expect(readSearchState(new URLSearchParams("ammoGen=60")).filters).toEqual({
      ammoGenAbove: 60,
    });
  });

  it("replaces a single-valued filter", () => {
    const standard = { param: "adept", value: "false", label: "Standard" };
    expect(
      withFilter(new URLSearchParams("adept=true"), standard, {
        max: 1,
      }).toString(),
    ).toBe("adept=false");
  });

  it("builds a pair in two picks and starts over once it's full", () => {
    const pick = (params: URLSearchParams, value: string) =>
      withFilter(
        params,
        { param: "perkCombo", value, label: value },
        {
          pair: true,
        },
      );
    const half = pick(new URLSearchParams(), "A");
    expect(pendingPairValue(half, "perkCombo")).toBe("A");
    const full = pick(half, "B");
    expect(full.getAll("perkCombo")).toEqual(["A", "B"]);
    expect(pendingPairValue(full, "perkCombo")).toBeUndefined();
    expect(pick(full, "C").getAll("perkCombo")).toEqual(["C"]);
  });

  it("removes both halves of a pair with its chip", () => {
    const params = new URLSearchParams("perkCombo=A&perkCombo=B&element=Arc");
    const [chip] = activeFilterChips(readSearchState(params)).filter(
      (c) => c.param === "perkCombo",
    );
    expect(withoutFilter(params, chip).toString()).toBe("element=Arc");
  });

  it("removes one value and leaves the rest", () => {
    const next = withoutFilter(
      new URLSearchParams("element=Solar&element=Arc&q=x"),
      {
        param: "element",
        value: "Solar",
      },
    );
    expect(next.toString()).toBe("q=x&element=Arc");
  });
});

describe("activeFilterChips", () => {
  it("follows the order filters were added when given the URL", () => {
    const params = new URLSearchParams("source=Solo+Ops&trait1=Kill+Clip");
    const withFrame = withFilter(params, {
      param: "frame",
      value: "Aggressive Frame",
      label: "",
    });
    expect(
      activeFilterChips(readSearchState(withFrame), withFrame).map(
        (c) => c.param,
      ),
    ).toEqual(["source", "trait1", "frame"]);
  });

  it("shows a perk combo as one chip, marking a missing second perk", () => {
    const text = (query: string) =>
      activeFilterChips(readSearchState(new URLSearchParams(query))).map(
        (c) => c.text,
      );
    expect(text("perkCombo=Kill+Clip")).toEqual(["Perk combo: Kill Clip + …"]);
    expect(text("perkCombo=Kill+Clip&perkCombo=Rampage")).toEqual([
      "Perk combo: Kill Clip + Rampage",
    ]);
  });

  it("names each applied filter and round-trips its param", () => {
    const params = new URLSearchParams(
      "element=Solar&trait1DamagePerks=true&ammoGen=45&adept=false",
    );
    params.append("group", JSON.stringify(["Firefly", "Incandescent"]));
    const chips = activeFilterChips(readSearchState(params));
    expect(chips.map((c) => c.text)).toEqual([
      "Trait 1: damage perks",
      "Element: Solar",
      "Ammo gen > 45",
      "Standard",
      "Any: Firefly / Incandescent",
    ]);
    const cleared = chips.reduce(
      (acc, chip) => withoutFilter(acc, chip),
      params,
    );
    expect(cleared.toString()).toBe("");
  });
});
