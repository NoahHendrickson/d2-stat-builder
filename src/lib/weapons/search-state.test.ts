import { describe, expect, it } from "vitest";
import { describeSearchState, readSearchState } from "./search-state";

describe("describeSearchState", () => {
  it("falls back to a neutral label for an empty search", () => {
    expect(describeSearchState(readSearchState(new URLSearchParams()))).toBe("All weapons");
  });

  it("names every filter instead of dumping raw values", () => {
    const params = new URLSearchParams(
      "q=fate&element=Solar&trait1=Reconstruction&adept=true&trait2DamagePerks=true",
    );
    params.append("group", JSON.stringify(["Firefly", "Incandescent"]));
    expect(describeSearchState(readSearchState(params))).toBe(
      "fate · Element: Solar · Trait 1: Reconstruction · Adept · Trait 2: damage perks · Any: Firefly / Incandescent",
    );
  });

  it("labels the standard-only adept filter", () => {
    expect(describeSearchState(readSearchState(new URLSearchParams("adept=false")))).toBe(
      "Standard",
    );
  });
});
