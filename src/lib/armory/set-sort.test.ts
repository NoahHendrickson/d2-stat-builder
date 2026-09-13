import { describe, expect, it } from "vitest";
import { sortSets } from "./set-sort";

const sets = [
  { name: "Bushido", ownedCount: 3 },
  { name: "Aion Renewal", ownedCount: 5 },
  { name: "Coda", ownedCount: 3 },
  { name: "Dark Age", ownedCount: 0 },
];

describe("sortSets", () => {
  it("orders by owned count descending, then name", () => {
    expect(sortSets(sets, "owned-desc").map((s) => s.name)).toEqual([
      "Aion Renewal",
      "Bushido",
      "Coda",
      "Dark Age",
    ]);
  });

  it("orders by owned count ascending, then name", () => {
    expect(sortSets(sets, "owned-asc").map((s) => s.name)).toEqual([
      "Dark Age",
      "Bushido",
      "Coda",
      "Aion Renewal",
    ]);
  });

  it("orders by name in both directions", () => {
    expect(sortSets(sets, "name-asc").map((s) => s.name)).toEqual([
      "Aion Renewal",
      "Bushido",
      "Coda",
      "Dark Age",
    ]);
    expect(sortSets(sets, "name-desc").map((s) => s.name)).toEqual([
      "Dark Age",
      "Coda",
      "Bushido",
      "Aion Renewal",
    ]);
  });

  it("does not mutate the input", () => {
    const copy = [...sets];
    sortSets(sets, "name-desc");
    expect(sets).toEqual(copy);
  });
});
