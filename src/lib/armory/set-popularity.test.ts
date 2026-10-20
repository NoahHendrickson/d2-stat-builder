import { describe, expect, it } from "vitest";
import { bucketView, setConfig, type BucketTally } from "./set-popularity";

describe("setConfig", () => {
  it("reads 4 or 5 pieces of one set as its 4-piece", () => {
    expect(setConfig([7, 7, 7, 7, 8])).toEqual({ kind: "four", sets: [7] });
    expect(setConfig([7, 7, 7, 7, 7])).toEqual({ kind: "four", sets: [7] });
  });
  it("reads two sets of 2 or more as a pair, lower hash first", () => {
    expect(setConfig([9, 9, 7, 7, undefined])).toEqual({ kind: "pair", sets: [7, 9] });
    expect(setConfig([9, 9, 9, 7, 7])).toEqual({ kind: "pair", sets: [7, 9] });
  });
  it("reads one set of 2 or 3 as its 2-piece", () => {
    expect(setConfig([7, 7, 7, 8, undefined])).toEqual({ kind: "two", sets: [7] });
  });
  it("reads no set with 2 pieces as no bonus", () => {
    expect(setConfig([7, 8, 9, undefined, undefined])).toEqual({ kind: "none", sets: [] });
    expect(setConfig([])).toEqual({ kind: "none", sets: [] });
  });
});

describe("bucketView", () => {
  // 5 characters: two 4-piece set 7, one 7 + 9 pair, one 2-piece 9, one with no bonus.
  const tally: BucketTally = {
    samples: 5,
    counts: { none: { "": 1 }, two: { 9: 1 }, pair: { "7,9": 1 }, four: { 7: 2 } },
  };

  it("splits the bucket by kind of setup", () => {
    expect(bucketView(tally).shape).toEqual({ none: 0.2, two: 0.2, pair: 0.2, four: 0.4 });
  });

  it("shares each set's bonuses, a pair counting toward both its sets", () => {
    const view = bucketView(tally);
    expect(view.sets.map((s) => s.setHash)).toEqual([7, 9]);
    expect(view.sets[0]).toMatchObject({ four: 0.4, two: 0.2 });
    expect(view.sets[0].any).toBeCloseTo(0.6);
    expect(view.sets[1]).toMatchObject({ four: 0, two: 0.4, any: 0.4 });
    expect(view.pairs).toEqual([{ sets: [7, 9], share: 0.2 }]);
  });
});
