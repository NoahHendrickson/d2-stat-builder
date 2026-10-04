import { describe, expect, test } from "vitest";
import {
  ItemPerkColumns,
  PerkCombo,
  PerkFinderResult,
  PerkPick,
  perkFinderInput,
  activePicks,
  addCombo,
  comparePerkFinderItems,
  defaultPriority,
  findPerkFinderResult,
  pickRanks,
  splitPicks,
  togglePick,
} from "./perk-finder";
import type { WeaponRoll } from "./weapon-details";

// Perk hashes, named for readability
const [barrel1, barrel2, mag1, mag2] = [1, 2, 3, 4];
const [leftA, leftB, leftC, rightX, rightY, rightZ] = [10, 11, 12, 20, 21, 22];
const [range, stability] = [1240105489, 155624089];

const barrel = (hash: number): PerkPick => ({ column: 0, hash });
const mag = (hash: number): PerkPick => ({ column: 1, hash });
const left = (hash: number): PerkPick => ({ column: 2, hash });
const right = (hash: number): PerkPick => ({ column: 3, hash });
const masterwork = (hash: number): PerkPick => ({ column: 4, hash });
const origin = (hash: number): PerkPick => ({ column: 5, hash });

function gun(
  id: string,
  lefts: number[],
  rights: number[],
  {
    barrels = [barrel1],
    mags = [mag1],
    mw = stability,
    origins = [],
  }: { barrels?: number[]; mags?: number[]; mw?: number; origins?: number[] } = {},
): { id: string; columns: ItemPerkColumns } {
  return {
    id,
    columns: [new Set(barrels), new Set(mags), new Set(lefts), new Set(rights), new Set([mw]), new Set(origins)],
  };
}

const keepOf = (result: { keep: Set<string> }) => [...result.keep].sort();
const sortedIds = (result: PerkFinderResult, ids: string[]) =>
  ids.toSorted(comparePerkFinderItems(result));

describe("the pool: left and right perks", () => {
  test("keeps nothing when nothing is picked", () => {
    const result = findPerkFinderResult([gun("1", [leftA], [rightX])], [], "loose");
    expect(result.keep.size).toBe(0);
    expect(result.pickedCount).toBe(0);
  });

  test("keeps a single gun that has every pick", () => {
    const guns = [gun("1", [leftA], [rightX]), gun("2", [leftA, leftB], [rightX, rightY])];
    const picks = [left(leftA), left(leftB), right(rightX), right(rightY)];
    const result = findPerkFinderResult(guns, picks, "strict");
    expect(keepOf(result)).toEqual(["2"]);
    expect(result.matchedCount.get("1")).toBe(2);
    expect(result.matchedCount.get("2")).toBe(4);
  });

  test("every perk mode only needs each perk somewhere", () => {
    const guns = [gun("1", [leftA], [rightX]), gun("2", [leftB], [rightY])];
    const picks = [left(leftA), left(leftB), right(rightX), right(rightY)];
    const result = findPerkFinderResult(guns, picks, "loose");
    expect(keepOf(result)).toEqual(["1", "2"]);
    expect(result.partialRequirements).toBe(0);
  });

  test("combos no gun fully has go to the closest gun", () => {
    // Nothing can make A + Y or B + X
    const guns = [gun("1", [leftA], [rightX]), gun("2", [leftB], [rightY])];
    const picks = [left(leftA), left(leftB), right(rightX), right(rightY)];
    const result = findPerkFinderResult(guns, picks, "strict");
    expect(keepOf(result)).toEqual(["1", "2"]);
    expect(result.totalRequirements).toBe(4);
    expect(result.coveredRequirements).toBe(4);
    expect(result.partialRequirements).toBe(2);
  });

  test("every combo mode can need more guns than every perk mode", () => {
    const guns = [
      gun("1", [leftA, leftB], [rightX]),
      gun("2", [leftA], [rightY]),
      gun("3", [leftB], [rightY]),
    ];
    const picks = [left(leftA), left(leftB), right(rightX), right(rightY)];
    expect(findPerkFinderResult(guns, picks, "loose").keep.size).toBe(2);
    expect(findPerkFinderResult(guns, picks, "strict").keep.size).toBe(3);
  });

  test("finds the smallest set even when greedy would pick more", () => {
    // Greedy would take gun 1 first (covers 4), then need 2 more. The best answer is guns 2 + 3.
    const guns = [
      gun("1", [leftA, leftB], [rightY, rightZ]),
      gun("2", [leftA, leftB, leftC], []),
      gun("3", [], [rightX, rightY, rightZ]),
    ];
    const picks = [
      left(leftA),
      left(leftB),
      left(leftC),
      right(rightX),
      right(rightY),
      right(rightZ),
    ];
    expect(keepOf(findPerkFinderResult(guns, picks, "loose"))).toEqual(["2", "3"]);
  });

  test("ignores guns that match nothing", () => {
    const guns = [gun("1", [leftC], [rightZ]), gun("2", [leftA], [rightX])];
    const result = findPerkFinderResult(guns, [left(leftA), right(rightX)], "strict");
    expect(keepOf(result)).toEqual(["2"]);
    expect(result.matchedCount.get("1")).toBe(0);
  });

  test("the order traits were picked in does not matter until ranked", () => {
    // No gun has A + X or A + Y. One gun has just A, the other has X and Y.
    const guns = [gun("onlyA", [leftA], [rightZ]), gun("xAndY", [leftB], [rightX, rightY])];
    const picks = [left(leftA), right(rightX), right(rightY)];
    // Tied traits: both guns are equally close to each combo, so the gun with more picks wins
    expect(keepOf(findPerkFinderResult(guns, picks, "strict"))).toEqual(["xAndY"]);
    // Once A is explicitly ranked first, the gun with A is closer
    expect(keepOf(findPerkFinderResult(guns, picks, "strict", true))).toEqual(["onlyA"]);
  });
});

describe("the order: masterwork, barrel, and magazine", () => {
  const traits = [left(leftA), left(leftB), right(rightX), right(rightY)];

  test("never change how many guns are kept", () => {
    const guns = [
      gun("1", [leftA, leftB], [rightX, rightY], { mags: [mag2] }),
      gun("2", [leftA], [rightX], { mags: [mag1] }),
      gun("3", [leftB], [rightY], { barrels: [barrel2] }),
    ];
    const extras = [mag(mag1), barrel(barrel2), masterwork(range)];
    for (const mode of ["strict", "loose"] as const) {
      expect(findPerkFinderResult(guns, [...traits, ...extras], mode).keep.size).toBe(
        findPerkFinderResult(guns, traits, mode).keep.size,
      );
    }
  });

  test("never drop a gun with the traits for missing them", () => {
    const guns = [
      gun("traits", [leftA], [rightX], { mags: [mag2], mw: stability }),
      gun("other", [leftB], [rightY], { mags: [mag1], mw: range }),
    ];
    const picks = [...traits, mag(mag1), masterwork(range)];
    expect(keepOf(findPerkFinderResult(guns, picks, "strict"))).toEqual(["other", "traits"]);
  });

  test("choose between equally good guns", () => {
    const guns = [
      gun("plain", [leftA], [rightX], { mags: [mag2] }),
      gun("withMag", [leftA], [rightX], { mags: [mag1] }),
    ];
    const result = findPerkFinderResult(guns, [left(leftA), right(rightX), mag(mag1)], "strict");
    expect(keepOf(result)).toEqual(["withMag"]);
  });

  test("do not add a gun to get a second magazine", () => {
    const guns = [
      gun("mag1", [leftA], [rightX], { mags: [mag1] }),
      gun("mag2", [leftA], [rightX], { mags: [mag2] }),
    ];
    const picks = [left(leftA), right(rightX), mag(mag1), mag(mag2)];
    expect(findPerkFinderResult(guns, picks, "strict").keep.size).toBe(1);
  });

  test("keep nothing without left or right perk picks", () => {
    const guns = [gun("1", [leftA], [rightX], { mags: [mag1] })];
    const result = findPerkFinderResult(guns, [mag(mag1), masterwork(stability)], "strict");
    expect(result.keep.size).toBe(0);
    expect(result.poolPickCount).toBe(0);
    expect(result.orderScore.get("1")).toEqual([2]);
  });

  test("sort kept guns by how many they have", () => {
    const guns = [
      gun("none", [leftA], [], { mags: [mag2], mw: stability }),
      gun("both", [], [rightX], { mags: [mag1], mw: range }),
      gun("one", [leftB], [rightY], { mags: [mag1], mw: stability }),
    ];
    const picks = [...traits, mag(mag1), masterwork(range)];
    const result = findPerkFinderResult(guns, picks, "loose");
    expect(keepOf(result)).toEqual(["both", "none", "one"]);
    expect(sortedIds(result, ["none", "one", "both"])).toEqual(["both", "one", "none"]);
  });

  test("sort the rest by their left and right perks first", () => {
    const guns = [
      gun("keeper", [leftA, leftB], [rightX, rightY]),
      gun("extras", [], [], { mags: [mag1], mw: range }),
      gun("traits", [leftA], [rightX]),
    ];
    const result = findPerkFinderResult(guns, [...traits, mag(mag1), masterwork(range)], "strict");
    expect(sortedIds(result, ["extras", "traits", "keeper"])).toEqual([
      "keeper",
      "traits",
      "extras",
    ]);
  });

  test("count equally until ranked", () => {
    const guns = [
      gun("mw", [leftA], [rightX], { mags: [mag2], mw: range }),
      gun("magAndBarrel", [leftA], [rightX], { barrels: [barrel2], mags: [mag1] }),
    ];
    const picks = [left(leftA), right(rightX), masterwork(range), barrel(barrel2), mag(mag1)];
    // Default: two picks beat one
    expect(keepOf(findPerkFinderResult(guns, picks, "strict"))).toEqual(["magAndBarrel"]);
    // Ranked: the masterwork is ranked first, and outweighs everything below it
    expect(keepOf(findPerkFinderResult(guns, picks, "strict", true))).toEqual(["mw"]);
  });
});

describe("ranking", () => {
  test("ties every pick until ranked", () => {
    const priority = [left(leftA), right(rightX), mag(mag1), barrel(barrel1)];
    expect(pickRanks(priority, false)).toEqual([0, 0, 0, 0]);
    expect(pickRanks(priority, true)).toEqual([0, 1, 2, 3]);
  });

  test("picks ranked above a left or right perk define the pool", () => {
    const priority = [mag(mag1), left(leftA), masterwork(range), right(rightX), barrel(barrel1)];
    expect(splitPicks(priority, true)).toEqual({
      poolPicks: [mag(mag1), left(leftA), masterwork(range), right(rightX)],
      orderPicks: [barrel(barrel1)],
    });
    // Without ranking on, only left and right perks do
    expect(splitPicks(priority, false).poolPicks).toEqual([left(leftA), right(rightX)]);
  });

  test("a magazine ranked above a trait beats that trait", () => {
    const guns = [
      gun("trait", [leftA], [rightX], { mags: [mag2] }),
      gun("magazine", [leftA], [rightY], { mags: [mag1] }),
    ];
    // No gun has the whole combo
    const magFirst = [left(leftA), mag(mag1), right(rightX)];
    const magLast = [left(leftA), right(rightX), mag(mag1)];
    expect(keepOf(findPerkFinderResult(guns, magFirst, "strict", true))).toEqual(["magazine"]);
    expect(keepOf(findPerkFinderResult(guns, magLast, "strict", true))).toEqual(["trait"]);
  });

  test("magazines ranked above a trait can add a gun", () => {
    const guns = [
      gun("mag1", [leftA], [rightX], { mags: [mag1] }),
      gun("mag2", [leftA], [rightX], { mags: [mag2] }),
    ];
    const above = [mag(mag1), mag(mag2), left(leftA), right(rightX)];
    const below = [left(leftA), right(rightX), mag(mag1), mag(mag2)];
    expect(findPerkFinderResult(guns, above, "strict", true).keep.size).toBe(2);
    expect(findPerkFinderResult(guns, below, "strict", true).keep.size).toBe(1);
  });
});

describe("origin traits", () => {
  const [veist, nadir] = [50, 51];

  test("choose between equally good guns, and sort them", () => {
    const guns = [
      gun("plain", [leftA], [rightX], { origins: [veist] }),
      gun("nadir", [leftA], [rightX], { origins: [nadir] }),
    ];
    const result = findPerkFinderResult(guns, [left(leftA), right(rightX), origin(nadir)], "strict");
    expect(keepOf(result)).toEqual(["nadir"]);
    expect(sortedIds(result, ["plain", "nadir"])).toEqual(["nadir", "plain"]);
  });

  test("a gun that can roll either origin trait has both", () => {
    const guns = [
      gun("both", [leftA], [rightX], { origins: [veist, nadir] }),
      gun("one", [leftA], [rightX], { origins: [veist] }),
    ];
    const result = findPerkFinderResult(guns, [left(leftA), right(rightX), origin(veist), origin(nadir)], "strict");
    expect(keepOf(result)).toEqual(["both"]);
    expect(result.matchedCount.get("both")).toBe(4);
  });

  test("ranked above a trait, an origin trait can add a gun", () => {
    const guns = [
      gun("veist", [leftA], [rightX], { origins: [veist] }),
      gun("nadir", [leftA], [rightX], { origins: [nadir] }),
    ];
    const above = [origin(veist), origin(nadir), left(leftA), right(rightX)];
    const below = [left(leftA), right(rightX), origin(veist), origin(nadir)];
    expect(findPerkFinderResult(guns, above, "strict", true).keep.size).toBe(2);
    expect(findPerkFinderResult(guns, below, "strict", true).keep.size).toBe(1);
  });

  test("new origin trait picks go after masterworks, barrels, and magazines", () => {
    expect(togglePick([left(leftA), mag(mag1)], origin(veist))).toEqual([left(leftA), mag(mag1), origin(veist)]);
    expect(togglePick([left(leftA), origin(veist)], barrel(barrel1))).toEqual([
      left(leftA),
      barrel(barrel1),
      origin(veist),
    ]);
  });
});

describe("togglePick", () => {
  test("orders new picks as traits, then masterworks, barrels, and magazines", () => {
    let priority: PerkPick[] = [];
    priority = togglePick(priority, mag(mag1));
    priority = togglePick(priority, barrel(barrel1));
    priority = togglePick(priority, masterwork(range));
    priority = togglePick(priority, left(leftA));
    priority = togglePick(priority, right(rightX));
    expect(priority).toEqual([
      left(leftA),
      right(rightX),
      masterwork(range),
      barrel(barrel1),
      mag(mag1),
    ]);
  });

  test("keeps a manual ordering when adding picks", () => {
    // The user ranked the right perk above the left one
    const priority = [right(rightX), left(leftA), mag(mag1)];
    expect(togglePick(priority, right(rightY))).toEqual([
      right(rightX),
      left(leftA),
      right(rightY),
      mag(mag1),
    ]);
  });

  test("removes a pick that is already picked", () => {
    expect(togglePick([left(leftA), right(rightX)], left(leftA))).toEqual([right(rightX)]);
  });
});

describe("defaultPriority", () => {
  test("orders left perks, right perks, masterworks, barrels, then magazines", () => {
    const columns = [
      { index: 0, itemTypeName: "", options: [] },
      { index: 2, itemTypeName: "", options: [{ hash: leftB }, { hash: leftA }] },
    ] as unknown as Parameters<typeof defaultPriority>[1];
    const priority = [
      mag(mag1),
      right(rightX),
      barrel(barrel1),
      left(leftA),
      masterwork(range),
      left(leftB),
    ];
    expect(defaultPriority(priority, columns)).toEqual([
      // In the order they"re listed in their column
      left(leftB),
      left(leftA),
      right(rightX),
      masterwork(range),
      barrel(barrel1),
      mag(mag1),
    ]);
  });
});

describe("rolls you cannot keep", () => {
  test("a vendor roll never stands in for owned copies", () => {
    const guns = [
      { ...gun("vendor", [leftA], [rightX]), keepable: false },
      gun("ownedA", [leftA], []),
      gun("ownedX", [], [rightX]),
    ];
    const result = findPerkFinderResult(guns, [left(leftA), right(rightX)], "loose");
    expect(keepOf(result)).toEqual(["ownedA", "ownedX"]);
    // It still gets scored and sorted like the rest
    expect(result.matchedCount.get("vendor")).toBe(2);
    expect(sortedIds(result, ["ownedA", "vendor", "ownedX"])).toEqual([
      "ownedA",
      "ownedX",
      "vendor",
    ]);
  });

  test("keeps nothing when only a vendor roll has the picks", () => {
    const guns = [{ ...gun("vendor", [leftA], [rightX]), keepable: false }];
    const result = findPerkFinderResult(guns, [left(leftA), right(rightX)], "strict");
    expect(result.keep.size).toBe(0);
    expect(result.coveredRequirements).toBe(0);
  });
});

describe("ranking precision", () => {
  test("every ranked pick counts, however many there are", () => {
    const barrels = Array.from({ length: 15 }, (_, i) => 100 + i);
    const picks = [left(leftA), right(rightX), ...barrels.map(barrel)];
    const guns = [
      gun("top", [leftA], [rightX], { barrels: [barrels[0]] }),
      gun("topAndLast", [leftA], [rightX], { barrels: [barrels[0], barrels[14]] }),
    ];
    const result = findPerkFinderResult(guns, picks, "strict", true);
    expect(keepOf(result)).toEqual(["topAndLast"]);
    expect(sortedIds(result, ["top", "topAndLast"])).toEqual(["topAndLast", "top"]);
  });
});

describe("the smallest set", () => {
  test("finds two guns where greedy would take three", () => {
    // A greedy search grabs "five" first, then needs two more; "odd" and "even" alone suffice
    const lefts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 100 + n);
    const guns = [
      gun("five", lefts.slice(0, 5), []),
      gun(
        "odd",
        lefts.filter((_, i) => i % 2 === 0),
        [],
      ),
      gun(
        "even",
        lefts.filter((_, i) => i % 2 === 1),
        [],
      ),
    ];
    const result = findPerkFinderResult(guns, lefts.map(left), "loose");
    expect(keepOf(result)).toEqual(["even", "odd"]);
    expect(result.approximate).toBe(false);
  });

  test("many copies are still solved exactly", () => {
    const lefts = Array.from({ length: 24 }, (_, i) => 100 + i);
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const guns = Array.from({ length: 30 }, (_, i) => {
      const rolls = lefts.filter(() => rand() < 0.17);
      return gun(`copy${i}`, rolls.length ? rolls : [lefts[i % lefts.length]], []);
    });
    const result = findPerkFinderResult(guns, lefts.map(left), "loose");
    expect(result.approximate).toBe(false);
    // Nothing kept is redundant
    const kept = guns.filter((g) => result.keep.has(g.id));
    for (const g of kept) {
      const others = new Set(kept.filter((o) => o !== g).flatMap((o) => [...o.columns[2]]));
      expect([...g.columns[2]].some((h) => !others.has(h))).toBe(true);
    }
  });
});

describe("my combos", () => {
  const combo = (l: number, r: number): PerkCombo => [left(l), right(r)];

  test("only needs the combos you made, not every combo", () => {
    const guns = [
      gun("1", [leftA, leftB], [rightX]),
      gun("2", [leftA], [rightY]),
      gun("3", [leftB], [rightY]),
    ];
    const combos = [combo(leftA, rightX), combo(leftB, rightX)];
    const result = findPerkFinderResult(guns, [], "combos", false, combos);
    expect(keepOf(result)).toEqual(["1"]);
    expect(result.totalRequirements).toBe(2);
    expect(result.pickedCount).toBe(3);

    const picks = [left(leftA), left(leftB), right(rightX), right(rightY)];
    expect(findPerkFinderResult(guns, picks, "strict").keep.size).toBe(3);
  });

  test("a left perk can be in combos with several right perks", () => {
    const guns = [
      gun("1", [leftA], [rightX]),
      gun("2", [leftA], [rightY]),
      gun("3", [leftA], [rightX, rightY]),
    ];
    const combos = [combo(leftA, rightX), combo(leftA, rightY)];
    expect(keepOf(findPerkFinderResult(guns, [], "combos", false, combos))).toEqual(["3"]);
  });

  test("keeps nothing without combos", () => {
    const guns = [gun("1", [leftA], [rightX])];
    const result = findPerkFinderResult(guns, [barrel(barrel1)], "combos", false, []);
    expect(result.keep.size).toBe(0);
    expect(result.poolPickCount).toBe(0);
    expect(result.pickedCount).toBe(1);
  });

  test("ignores left and right perk picks, but masterwork, barrel, and magazine picks still sort", () => {
    const guns = [
      gun("1", [leftA], [rightX]),
      gun("2", [leftA], [rightX], { barrels: [barrel2] }),
      gun("3", [leftC], [rightZ]),
    ];
    const result = findPerkFinderResult(guns, [left(leftC), barrel(barrel2)], "combos", false, [
      combo(leftA, rightX),
    ]);
    expect(keepOf(result)).toEqual(["2"]);
    expect(result.pickedCount).toBe(3);
  });

  test("ignores ranking, so a barrel never decides which copies to keep", () => {
    const guns = [gun("1", [leftA], [rightX]), gun("2", [leftC], [rightZ], { barrels: [barrel2] })];
    const result = findPerkFinderResult(guns, [barrel(barrel2), left(leftC)], "combos", true, [
      combo(leftA, rightX),
    ]);
    expect(keepOf(result)).toEqual(["1"]);
    expect(result.poolPickCount).toBe(2);
  });
});

describe("addCombo", () => {
  test("does not add a combo twice", () => {
    const combos: PerkCombo[] = [[left(leftA), right(rightX)]];
    expect(addCombo(combos, [left(leftA), right(rightX)])).toBe(combos);
    expect(addCombo(combos, [left(leftA), right(rightY)])).toHaveLength(2);
  });
});

describe("activePicks", () => {
  test("uses each combo perk once in combo mode", () => {
    const combos: PerkCombo[] = [
      [left(leftA), right(rightX)],
      [left(leftA), right(rightY)],
    ];
    expect(activePicks([left(leftB), mag(mag2)], "combos", combos)).toEqual([
      left(leftA),
      right(rightX),
      right(rightY),
      mag(mag2),
    ]);
    expect(activePicks([left(leftB)], "loose", combos)).toEqual([left(leftB)]);
  });
});

describe("perkFinderInput", () => {
  const plug = (hash: number, name: string, enhanced = false) => ({ hash, name, ...(enhanced ? { enhanced } : {}) });
  const column = (socketIndex: number, category: string, typeName: string, options: ReturnType<typeof plug>[]) => ({
    socketIndex,
    current: options[0]!,
    options,
    origin: category === "origins",
    category,
    typeName,
  });
  const roll = (barrels: ReturnType<typeof plug>[], lefts: ReturnType<typeof plug>[], mw?: string): WeaponRoll => ({
    columns: [
      column(1, "barrels", "Barrel", barrels),
      column(2, "magazines", "Magazine", [plug(30, "Tactical Mag")]),
      column(3, "frames", "Trait", lefts),
      column(4, "frames", "Trait", [plug(40, "Kill Clip")]),
      column(8, "origins", "Origin Trait", [plug(50, "Veist Stinger")]),
    ],
    mods: mw ? [{ hash: 60, name: `Masterworked: ${mw}`, kind: "masterwork", stat: { hash: mw === "Range" ? range : stability, name: mw } }] : [],
  });

  test("an enhanced perk counts as its base perk", () => {
    const { columns, items } = perkFinderInput([
      { id: "a", roll: roll([plug(1, "Arrowhead Brake")], [plug(911, "Outlaw", true)], "Range") },
      { id: "b", roll: roll([plug(1, "Arrowhead Brake")], [plug(11, "Outlaw"), plug(12, "Rapid Hit")], "Stability") },
    ]);
    expect(columns.map((c) => [c.index, c.typeName, c.options.map((o) => `${o.name} ${o.hash} ×${o.count}`)])).toEqual([
      [0, "Barrel", ["Arrowhead Brake 1 ×2"]],
      [1, "Magazine", ["Tactical Mag 30 ×2"]],
      [2, "Trait", ["Outlaw 11 ×2", "Rapid Hit 12 ×1"]],
      [3, "Trait", ["Kill Clip 40 ×2"]],
      [4, "", ["Range " + range + " ×1", "Stability " + stability + " ×1"]],
      [5, "Origin Trait", ["Veist Stinger 50 ×2"]],
    ]);
    // Both copies can take the same combo, so one is enough.
    const result = findPerkFinderResult(items, [left(11), right(40)], "strict");
    expect(result.keep.size).toBe(1);
    expect(result.matchedCount.get("a")).toBe(2);
  });

  test("offers every origin trait the copies can roll", () => {
    const withOrigins = (origins: ReturnType<typeof plug>[]): WeaponRoll => {
      const base = roll([plug(1, "Arrowhead Brake")], [plug(11, "Outlaw")]);
      return { ...base, columns: base.columns.map((c) => (c.origin ? column(8, "origins", "Origin Trait", origins) : c)) };
    };
    const { columns, items } = perkFinderInput([
      { id: "a", roll: withOrigins([plug(50, "Veist Stinger"), plug(51, "Nadir Focus")]) },
      { id: "b", roll: withOrigins([plug(51, "Nadir Focus")]) },
    ]);
    expect(columns.find((c) => c.index === 5)?.options.map((o) => `${o.name} ×${o.count}`)).toEqual([
      "Veist Stinger ×1",
      "Nadir Focus ×2",
    ]);
    expect(items.map((item) => [...item.columns[5]!])).toEqual([[50, 51], [51]]);
    // The masterwork column stays where it was.
    expect(items.map((item) => item.columns[4]!.size)).toEqual([0, 0]);
  });
});

test("sorting by an older result tolerates copies it doesn't know", () => {
  const result = findPerkFinderResult([gun("1", [leftA], [rightX]), gun("2", [leftB], [rightY])], [left(leftA)], "loose");
  expect(sortedIds(result, ["new", "2", "1"])).toEqual(["1", "new", "2"]);
});
