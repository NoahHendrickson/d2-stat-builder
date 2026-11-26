import { describe, expect, it } from "vitest";
import {
  MIN_COMBO_COUNT,
  MIN_MASTERWORK_COPIES,
  masterworkPopularity,
  mostPopularRoll,
  type MasterworkPopularity,
} from "./popularity-view";

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

  it("takes the top masterwork when its shares are shown, and none otherwise", () => {
    const shown: MasterworkPopularity = { state: "shown", slot: 3, counted: 40, perks: [], top: 8, partial: false };
    expect(mostPopularRoll(columns, [], shown)).toEqual({ 0: 2, 1: 3, 2: 5, 3: 8 });
    expect(mostPopularRoll(columns, [], { state: "few", counted: 12 })).toEqual({ 0: 2, 1: 3, 2: 5 });
    expect(mostPopularRoll(columns, [], { state: "none" })).toEqual({ 0: 2, 1: 3, 2: 5 });
  });
});

describe("masterworkPopularity", () => {
  // Three columns, so the masterwork slot is 3; masterworks Range (perk 7, hash 60),
  // Handling (8, hash 70), Stability (9, hash 80).
  const weapon = { columns: [{}, {}, {}] as never[], masterworks: [7, 8, 9] };
  const perks = Object.assign([], { 7: { hash: 60 }, 8: { hash: 70 }, 9: { hash: 80 } });
  const at = (counts: Record<number, number> | undefined, copies = 100) =>
    masterworkPopularity({ copies, masterworks: counts }, weapon, perks);

  it("shows every masterwork's share in the section's order, the top one, and whether the counted copies fall well short", () => {
    expect(at({ 60: 10, 70: 30 })).toEqual({
      state: "shown",
      slot: 3,
      counted: 40,
      perks: [
        { perkIndex: 7, share: 0.25 },
        { perkIndex: 8, share: 0.75 },
        { perkIndex: 9, share: 0 },
      ],
      top: 8,
      partial: true,
    });
    expect(at({ 60: 45, 70: 45 })).toMatchObject({ top: 7, partial: false });
  });

  it("has no shares until enough copies have one known, or before any are", () => {
    expect(at({ 60: MIN_MASTERWORK_COPIES - 1 })).toEqual({ state: "few", counted: MIN_MASTERWORK_COPIES - 1 });
    expect(at(undefined)).toEqual({ state: "none" });
  });

  it("counts only the weapon's own masterworks, so one the catalog no longer lists can't make every share 0%", () => {
    expect(at({ 99: 40, 60: 5 })).toEqual({ state: "few", counted: 5 });
  });

  it("is undefined for a weapon with no masterworks to pick", () => {
    expect(masterworkPopularity({ copies: 10 }, { columns: [], masterworks: undefined }, perks)).toBeUndefined();
  });
});
