import { describe, expect, it } from "vitest";
import { MIN_COMBO_COUNT, MIN_MASTERWORK_COPIES, mostPopularRoll } from "./popularity-view";

// Columns 0 (barrel), 1 and 2 (the traits), perks by catalog index.
const columns = [
  { column: 0, perks: [{ perkIndex: 1, share: 0.3 }, { perkIndex: 2, share: 0.7 }] },
  { column: 1, perks: [{ perkIndex: 3, share: 0.6 }, { perkIndex: 4, share: 0.4 }] },
  { column: 2, perks: [{ perkIndex: 5, share: 0.55 }, { perkIndex: 6, share: 0.45 }] },
];
const combo = (left: number, right: number, count: number) => ({
  leftColumn: 1,
  left,
  rightColumn: 2,
  right,
  count,
  share: count / 50,
});

describe("mostPopularRoll", () => {
  it("takes the top combo for the traits, though each column's winner differs", () => {
    // 3 and 5 win their columns, but are rarely run together. Not sorted: the
    // best combo is found, not assumed first.
    expect(mostPopularRoll(columns, [combo(3, 5, 5), combo(4, 6, 20)])).toEqual({ 0: 2, 1: 4, 2: 6 });
  });

  it("keeps the columns' winners when the top combo is too thin to go on", () => {
    expect(mostPopularRoll(columns, [combo(4, 6, MIN_COMBO_COUNT - 1)])).toEqual({ 0: 2, 1: 3, 2: 5 });
  });

  it("breaks a combo tie in grid order, as the columns do", () => {
    expect(mostPopularRoll(columns, [combo(4, 6, 4), combo(4, 5, 4), combo(3, 6, 4)])).toEqual({ 0: 2, 1: 3, 2: 6 });
  });

  it("falls back to each column's winner without a combo, first of a tie in grid order", () => {
    const tied = [{ column: 0, perks: [{ perkIndex: 1, share: 0.5 }, { perkIndex: 2, share: 0.5 }] }, ...columns.slice(1)];
    expect(mostPopularRoll(tied, [])).toEqual({ 0: 1, 1: 3, 2: 5 });
  });

  // The masterwork slot (3, after the columns): Range 7, Handling 8, Stability 9.
  const masterworks = (counted: number, shares: number[]) => ({
    slot: 3,
    counted,
    perks: shares.map((share, i) => ({ perkIndex: 7 + i, share })),
  });

  it("takes the most run masterwork once enough copies have one known, first of a tie in the section's order", () => {
    expect(mostPopularRoll(columns, [], masterworks(MIN_MASTERWORK_COPIES, [0.2, 0.5, 0.3]))).toEqual({ 0: 2, 1: 3, 2: 5, 3: 8 });
    expect(mostPopularRoll(columns, [], masterworks(MIN_MASTERWORK_COPIES, [0.4, 0.2, 0.4]))[3]).toBe(7);
  });

  it("leaves the masterwork out on too few copies with one known, or none", () => {
    expect(mostPopularRoll(columns, [], masterworks(MIN_MASTERWORK_COPIES - 1, [0.2, 0.5, 0.3]))).toEqual({ 0: 2, 1: 3, 2: 5 });
    expect(mostPopularRoll(columns, [], masterworks(0, [0, 0, 0]))).toEqual({ 0: 2, 1: 3, 2: 5 });
  });
});
