import { describe, expect, it } from "vitest";
import {
  addCopy,
  columnShares,
  copiesSeen,
  equippedPerks,
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

describe("equippedPerks", () => {
  const columns = popularityLookup(CATALOG).get(1)!;

  it("reads each column from the sockets in order", () => {
    // Sockets: frame, barrel 12, enhanced Rampage, Kill Clip, then a shader.
    expect(equippedPerks(columns, [10, 12, 400, 15, 999])).toEqual([undefined, 12, 14, 15]);
  });

  it("puts a perk both trait columns share in the column its socket belongs to", () => {
    expect(equippedPerks(columns, [10, 11, 14, 13])).toEqual([undefined, 11, 14, 13]);
    expect(equippedPerks(columns, [10, 11, 13, 15])).toEqual([undefined, 11, 13, 15]);
  });

  it("leaves a column it can't find empty and carries on", () => {
    expect(equippedPerks(columns, [10, undefined, 13, 15])).toEqual([undefined, undefined, 13, 15]);
  });
});

describe("tally and shares", () => {
  const tally: Record<string, WeaponPopularity> = {};
  addCopy(tally, 1, [undefined, 11, 14, 15], "pve");
  addCopy(tally, 1, [undefined, 11, 13, 15], "pve");
  addCopy(tally, 1, [undefined, 12, 14, 15], "pvp");
  const weapon = tally[1]!;

  it("counts copies per mode", () => {
    expect(weapon.copies).toEqual([2, 1]);
    expect(copiesSeen(weapon, "all")).toBe(3);
  });

  it("ranks a column's perks by copies in the chosen mode", () => {
    expect(columnShares(weapon, 1, "pve")).toEqual([{ hash: 11, count: 2, share: 1 }]);
    expect(columnShares(weapon, 2, "all")).toEqual([
      { hash: 14, count: 2, share: 2 / 3 },
      { hash: 13, count: 1, share: 1 / 3 },
    ]);
  });

  it("has nothing for a fixed column", () => {
    expect(columnShares(weapon, 0, "all")).toEqual([]);
  });
});
