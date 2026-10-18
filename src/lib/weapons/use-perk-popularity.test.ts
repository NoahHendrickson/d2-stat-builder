import { describe, expect, it } from "vitest";
import { mostPopularRoll } from "./use-perk-popularity";

// Columns 0 (barrel), 1 and 2 (the traits), perks by catalog index.
const columns = [
  { column: 0, perks: [{ perkIndex: 1, share: 0.3 }, { perkIndex: 2, share: 0.7 }] },
  { column: 1, perks: [{ perkIndex: 3, share: 0.6 }, { perkIndex: 4, share: 0.4 }] },
  { column: 2, perks: [{ perkIndex: 5, share: 0.55 }, { perkIndex: 6, share: 0.45 }] },
];

describe("mostPopularRoll", () => {
  it("takes the top combo for the traits, though each column's winner differs", () => {
    // 3 and 5 win their columns, but are rarely run together.
    const combos = [
      { leftColumn: 1, left: 4, rightColumn: 2, right: 6, share: 0.4 },
      { leftColumn: 1, left: 3, rightColumn: 2, right: 5, share: 0.1 },
    ];
    expect(mostPopularRoll(columns, combos)).toEqual({ 0: 2, 1: 4, 2: 6 });
  });

  it("falls back to each column's winner without a combo, first of a tie in grid order", () => {
    const tied = [{ column: 0, perks: [{ perkIndex: 1, share: 0.5 }, { perkIndex: 2, share: 0.5 }] }, ...columns.slice(1)];
    expect(mostPopularRoll(tied, [])).toEqual({ 0: 1, 1: 3, 2: 5 });
  });
});
