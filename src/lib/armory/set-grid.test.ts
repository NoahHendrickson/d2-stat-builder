import { describe, expect, it } from "vitest";
import {
  archetypeCounts,
  coveredSlots,
  setArchetypeGrid,
  tertiaryColumns,
  twoPlusTwoSplits,
} from "./set-grid";
import type { StatArray } from "./stats";

// STAT_ORDER: weapons 0, health 1, class 2, grenade 3, super 4, melee 5.
const GUNNER = { name: "Gunner", primary: 0, secondary: 3 };
const SET = 111;

function piece(
  slot: "helmet" | "arms" | "chest" | "legs" | "classItem",
  tertiary: number,
  opts: { archetype?: string; tuned?: number; setHash?: number } = {},
) {
  // Gunner's primary (0) and secondary (3) can't also be the tertiary.
  if (tertiary === 0 || tertiary === 3) throw new Error(`tertiary ${tertiary} is a Gunner archetype stat`);
  const baseStats = [0, 0, 0, 0, 0, 0] as StatArray;
  baseStats[0] = 30;
  baseStats[3] = 25;
  baseStats[tertiary] = 20;
  return {
    slot,
    setHash: opts.setHash ?? SET,
    archetype: opts.archetype ?? "Gunner",
    baseStats,
    tunedStat: opts.tuned,
  };
}

describe("setArchetypeGrid", () => {
  it("uses the archetype's four tertiaries as columns, in display order", () => {
    // Display order: health, melee, grenade, super, class, weapons.
    expect(tertiaryColumns(GUNNER)).toEqual([1, 5, 4, 2]);
  });

  it("counts pieces per slot × tertiary and collects their tuned stats", () => {
    const grid = setArchetypeGrid(
      [
        piece("helmet", 1, { tuned: 0 }),
        piece("helmet", 1, { tuned: 4 }),
        piece("helmet", 1, { tuned: 0 }),
        piece("chest", 2, { tuned: 5 }),
        piece("legs", 4), // tier 1–4: no tuned stat
        piece("arms", 1, { archetype: "Brawler" }), // other archetype
        piece("arms", 1, { setHash: 222 }), // other set
      ],
      SET,
      GUNNER,
    );
    const col = (s: number) => grid.columns.indexOf(s);
    expect(grid.rows[0][col(1)]).toEqual({ count: 3, tuned: [0, 4] });
    expect(grid.rows[2][col(2)]).toEqual({ count: 1, tuned: [5] });
    expect(grid.rows[3][col(4)]).toEqual({ count: 1, tuned: [] });
    expect(grid.rows[1].every((c) => c.count === 0)).toBe(true);
  });

  it("filters to one tuned stat", () => {
    const grid = setArchetypeGrid(
      [piece("helmet", 1, { tuned: 0 }), piece("helmet", 1, { tuned: 4 }), piece("legs", 4)],
      SET,
      GUNNER,
      0,
    );
    expect(grid.rows[0][grid.columns.indexOf(1)]).toEqual({ count: 1, tuned: [0] });
    expect(grid.rows[3][grid.columns.indexOf(4)].count).toBe(0);
  });
});

describe("archetypeCounts", () => {
  it("counts a set's pieces per archetype", () => {
    const counts = archetypeCounts(
      [piece("helmet", 1), piece("arms", 2), piece("legs", 1, { archetype: "Brawler" }), piece("chest", 1, { setHash: 9 })],
      SET,
    );
    expect(counts).toEqual(new Map([["Gunner", 2], ["Brawler", 1]]));
  });
});

describe("twoPlusTwoSplits", () => {
  it("lists every disjoint 2 + 2 over covered slots", () => {
    // First covers helmet, arms, chest; second covers chest, legs, class item.
    const splits = twoPlusTwoSplits(
      [true, true, true, false, false],
      [false, false, true, true, true],
    );
    const keys = splits.map((s) => `${s.first.join("")}|${s.second.join("")}|${s.free}`);
    expect(keys.sort()).toEqual(
      ["01|23|4", "01|24|3", "01|34|2", "02|34|1", "12|34|0"].sort(),
    );
  });

  it("is empty when a set covers fewer than two free slots", () => {
    expect(twoPlusTwoSplits([true, true, false, false, false], [true, true, false, false, false])).toEqual([]);
    expect(twoPlusTwoSplits([true, true, true, true, true], [false, false, false, false, true])).toEqual([]);
  });
});

describe("coveredSlots", () => {
  it("marks slots with any piece in any tertiary", () => {
    const grid = setArchetypeGrid([piece("helmet", 1), piece("legs", 4)], SET, GUNNER);
    expect(coveredSlots(grid)).toEqual([true, false, false, true, false]);
  });
});
