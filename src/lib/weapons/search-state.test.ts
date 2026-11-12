import { describe, expect, it } from "vitest";
import { readSearchState, withLegacyCraftableInQuery } from "./search-state";

const moved = (query: string) => withLegacyCraftableInQuery(new URLSearchParams(query))?.toString();

describe("withLegacyCraftableInQuery", () => {
  it("turns an old craftable= link into its typed word", () => {
    expect(moved("craftable=Yes")).toBe("q=is%3Acraftable");
    expect(moved("q=fatebringer&craftable=No&type=Hand+Cannon")).toBe(
      "q=fatebringer+not%3Acraftable&type=Hand+Cannon",
    );
    // Yes and No together matched everything.
    expect(moved("craftable=Yes&craftable=No")).toBe("");
    expect(moved("q=fatebringer")).toBeUndefined();
  });

  it("is what readSearchState searches with, leaving no Craftable chip", () => {
    const state = readSearchState(new URLSearchParams("craftable=Yes"));
    expect(state.query).toBe("is:craftable");
    expect(state.filters).toEqual({});
  });
});
