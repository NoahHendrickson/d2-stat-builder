import { describe, expect, it } from "vitest";
import {
  addCopy,
  columnShares,
  columnSockets,
  perksAtSockets,
  popularityLookup,
  type PopularityCatalog,
  type WeaponPopularity,
} from "./perk-popularity";

// Perk table: 0 frame, 1–2 barrels, 3 Opening Shot (both trait columns), 4 Rampage
// (enhanced 400), 5 Kill Clip.
const CATALOG: PopularityCatalog = {
  perks: [
    { hash: 10 },
    { hash: 11 },
    { hash: 12 },
    { hash: 13 },
    { hash: 14, alternateHashes: [400] },
    { hash: 15 },
  ],
  weapons: [
    {
      hash: 1,
      rarity: "Legendary",
      columns: [
        { perkIndices: [0] },
        { perkIndices: [1, 2] },
        { perkIndices: [3, 4] },
        { perkIndices: [3, 5] },
      ],
    },
    { hash: 2, rarity: "Exotic", columns: [{ perkIndices: [1, 2] }] },
  ],
};

describe("popularityLookup", () => {
  const lookup = popularityLookup(CATALOG);

  it("keeps random-rolled legendaries only", () => {
    expect([...lookup.keys()]).toEqual([1]);
  });

  it("maps enhanced plugs to their base perk and skips fixed columns", () => {
    const columns = lookup.get(1)!;
    expect(columns[0]!.size).toBe(0);
    expect(columns[2]!.get(400)).toBe(14);
  });
});

describe("columnSockets and perksAtSockets", () => {
  const columns = popularityLookup(CATALOG).get(1)!;
  // Socket layout of weapon 1: 0 frame, 1 barrel, 2 trait one, 3 trait two, 4 a shader.
  const copies = [
    [10, 12, 400, 15, 999],
    [10, 11, 14, 15, 998],
    [10, 11, 13, 15, 999],
  ];
  const sockets = columnSockets(columns, copies);

  it("places each column at the socket its own perks turn up in", () => {
    expect(sockets).toEqual([undefined, 1, 2, 3]);
  });

  it("reads a perk two columns share from the socket it sits in", () => {
    expect(perksAtSockets(columns, sockets, [10, 11, 13, 15, 999])).toEqual([undefined, 11, 13, 15]);
    expect(perksAtSockets(columns, sockets, [10, 11, 14, 13, 999])).toEqual([undefined, 11, 14, 13]);
  });

  it("leaves a column with an unlisted plug empty instead of taking its neighbour's perk", () => {
    // Trait one holds a plug the catalog doesn't list; trait two holds the shared Opening Shot.
    expect(perksAtSockets(columns, sockets, [10, 11, 777, 13, 999])).toEqual([undefined, 11, undefined, 13]);
  });

  it("doesn't let shared perks place a column, nor two columns share a socket", () => {
    expect(columnSockets(columns, [[10, 11, 13, 13]])).toEqual([undefined, 1, undefined, undefined]);
  });
});

describe("tally and shares", () => {
  const tally: Record<string, WeaponPopularity> = {};
  addCopy(tally, 1, [undefined, 11, 14, 15]);
  addCopy(tally, 1, [undefined, 11, 13, 15]);
  addCopy(tally, 1, [undefined, 12, 14, undefined]);
  const weapon = tally[1]!;

  it("counts copies, and each identified perk per column", () => {
    expect(weapon.copies).toBe(3);
    expect(weapon.columns).toEqual([{}, { 11: 2, 12: 1 }, { 14: 2, 13: 1 }, { 15: 2 }]);
  });

  it("ranks a column's perks by copies, as shares of the copies identified there", () => {
    expect(columnShares(weapon, 1)).toEqual([
      { hash: 11, count: 2, share: 2 / 3 },
      { hash: 12, count: 1, share: 1 / 3 },
    ]);
    // The third copy's last column wasn't identified, so it isn't in the share.
    expect(columnShares(weapon, 3)).toEqual([{ hash: 15, count: 2, share: 1 }]);
  });

  it("has nothing for a fixed column", () => {
    expect(columnShares(weapon, 0)).toEqual([]);
  });
});
