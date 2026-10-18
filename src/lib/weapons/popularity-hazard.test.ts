import { describe, expect, it } from "vitest";
import {
  describeHazard,
  emptyHazard,
  HAZARD_MAX_GAP,
  HAZARD_WEEKS,
  pruneHazard,
  recordHazard,
  type Hazard,
} from "./popularity-hazard";

/** Zeros up to `gap`, then `n`. */
const at = (gap: number, n = 1) => [...Array.from({ length: gap }, () => 0), n];

describe("recordHazard", () => {
  it("tallies checks by the week they were made in and the gap, longer gaps than the longest told apart as it", () => {
    const hazard = emptyHazard();
    recordHazard(hazard, 20_006, 7, false);
    recordHazard(hazard, 20_006, 7, true);
    recordHazard(hazard, 20_013, 200, true);
    // Out of order: the weeks stay sorted.
    recordHazard(hazard, 19_999, 1, false);
    expect(hazard).toEqual({
      weeks: [
        { day: 19_999, checked: at(1), gone: [] },
        { day: 20_006, checked: at(7, 2), gone: at(7) },
        { day: 20_013, checked: at(HAZARD_MAX_GAP), gone: at(HAZARD_MAX_GAP) },
      ],
    });
  });
});

describe("pruneHazard", () => {
  it("drops the weeks that started HAZARD_WEEKS or more before the window, and nothing when none did", () => {
    const hazard: Hazard = { weeks: [{ day: 19_999, checked: at(1), gone: [] }, { day: 20_006, checked: at(1), gone: [] }] };
    expect(pruneHazard(hazard, 19_999 + HAZARD_WEEKS * 7)).toEqual({ weeks: [hazard.weeks[1]] });
    expect(pruneHazard(hazard, 19_999 + HAZARD_WEEKS * 7 - 1)).toBe(hazard);
    expect(pruneHazard(undefined, 20_000)).toBeUndefined();
  });
});

describe("describeHazard", () => {
  it("says when nothing has been checked", () => {
    expect(describeHazard(undefined)).toBe("Copies out of the loadout, checked at a later whole read: none yet.");
    expect(describeHazard(emptyHazard())).toBe("Copies out of the loadout, checked at a later whole read: none yet.");
  });

  it("chains each gap's gone-rate into the share gone by each reported gap", () => {
    const hazard = emptyHazard();
    // 10 checked a week out, 1 gone; of the rest, 8 checked at two weeks, 2 gone; 2 checked at 93 days, 1 gone.
    for (let i = 0; i < 10; i++) recordHazard(hazard, 20_006, 7, i === 0);
    for (let i = 0; i < 8; i++) recordHazard(hazard, 20_013, 14, i < 2);
    for (let i = 0; i < 2; i++) recordHazard(hazard, 20_013, 93, i === 0);
    // Survived: 0.9 by 7 d, 0.9 × 0.75 = 0.675 by 14 d, and by 90 d or more 0.675 × 0.5 = 0.3375.
    expect(describeHazard(hazard)).toBe(
      "Copies out of the loadout, checked at a later whole read (20 checks over 2 weeks): gone by 7 d 10.0%, by 14 d 32.5%, by 30 d 32.5%, by 60 d 32.5%, by 90 d or more 66.3%, chained from the gone-rate at each gap.",
    );
  });
});
