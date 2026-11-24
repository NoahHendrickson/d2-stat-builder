import { describe, expect, it } from "vitest";
import {
  columnShares,
  comboShares,
  traitColumns,
  columnSockets,
  masterworkLookup,
  masterworkOf,
  masterworkShares,
  perksAtSockets,
  popularityLookup,
  type PopularityCatalog,
  type WeaponPopularity,
} from "./perk-popularity";

// Perk table: 0 frame, 1–2 barrels, 3 Opening Shot (both trait columns), 4 Rampage
// (enhanced 400), 5 Kill Clip, 6 Range Masterwork (tiers 601, 602), 7 Handling
// Masterwork (no other plugs).
const CATALOG: PopularityCatalog = {
  perks: [
    { hash: 10 },
    { hash: 11 },
    { hash: 12 },
    { hash: 13 },
    { hash: 14, alternateHashes: [400] },
    { hash: 15 },
    { hash: 60, tierHashes: [601, 602] },
    { hash: 70 },
  ],
  weapons: [
    {
      hash: 1,
      rarity: "Legendary",
      columns: [
        { kind: "Intrinsic", perkIndices: [0] },
        { kind: "Barrel", perkIndices: [1, 2] },
        { kind: "Trait", perkIndices: [3, 4] },
        { kind: "Trait", perkIndices: [3, 5] },
      ],
      masterworks: [6, 7],
    },
    { hash: 2, rarity: "Exotic", columns: [{ kind: "Barrel", perkIndices: [1, 2] }], masterworks: [6] },
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

describe("masterworkLookup and masterworkOf", () => {
  const masterworks = masterworkLookup(CATALOG);

  it("maps every tier of a masterwork's stat to its full tier, for the tally's weapons only", () => {
    expect([...masterworks.keys()]).toEqual([1]);
    expect([...masterworks.get(1)!]).toEqual([
      [60, 60],
      [601, 60],
      [602, 60],
      [70, 70],
    ]);
  });

  it("finds a copy's masterwork among all its plugs, whatever socket it's in", () => {
    expect(masterworkOf(masterworks.get(1), [10, 11, 13, 15, 602, 999])).toBe(60);
    expect(masterworkOf(masterworks.get(1), [70, undefined])).toBe(70);
  });

  it("takes the first one found: a crafted copy's enhanced frame (601 here) over its masterwork socket", () => {
    expect(masterworkOf(masterworks.get(1), [601, 11, 13, 15, 70])).toBe(60);
  });

  it("has none when no plug is a masterwork the catalog knows, or the weapon has none", () => {
    expect(masterworkOf(masterworks.get(1), [10, 11, 13, 15, 999])).toBeUndefined();
    expect(masterworkOf(masterworks.get(2), [60])).toBeUndefined();
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

describe("shares", () => {
  // Three copies: barrels 11, 11, 12; the third copy's last column wasn't identified.
  const weapon: WeaponPopularity = { copies: 3, columns: [{}, { 11: 2, 12: 1 }, { 14: 2, 13: 1 }, { 15: 2 }] };

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

describe("masterworkShares", () => {
  it("ranks masterworks by copies, as shares of the copies with one known", () => {
    expect(masterworkShares({ copies: 10, columns: [], masterworks: { 60: 1, 70: 3 } })).toEqual({
      counted: 4,
      shares: [
        { hash: 70, count: 3, share: 3 / 4 },
        { hash: 60, count: 1, share: 1 / 4 },
      ],
    });
  });

  it("counts none in a snapshot from before masterworks were kept", () => {
    expect(masterworkShares({ copies: 10, columns: [] })).toEqual({ counted: 0, shares: [] });
  });
});

describe("combos", () => {
  it("finds the left and right trait columns, only when there are exactly two", () => {
    expect(traitColumns(CATALOG.weapons[0]!.columns)).toEqual([2, 3]);
    expect(traitColumns([{ kind: "Trait" }, { kind: "Barrel" }])).toBeUndefined();
  });

  it("ranks combos by copies, as shares of the copies with both perks", () => {
    expect(comboShares({ copies: 4, columns: [], combos: { "13,15": 1, "14,15": 2 } })).toEqual([
      { left: 14, right: 15, count: 2, share: 2 / 3 },
      { left: 13, right: 15, count: 1, share: 1 / 3 },
    ]);
  });
});

