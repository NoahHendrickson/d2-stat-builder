import { expect, test } from "vitest";
import { emptyStatStates, overMaxCulprits } from "./over-max";
import type { OptimizerOutput } from "./types";

const empty = (ceilings: number[], uppers = ceilings): OptimizerOutput => ({
  loadouts: [],
  combosTried: 0,
  combosValid: 0,
  combosValidExact: true,
  ceilings,
  ceilingUppers: uppers,
  ceilingsExact: ceilings.every((v, s) => v === uppers[s]),
  capped: false,
});

// [weapons, health, class, grenade, super, melee]
test("one target past its max: it is the culprit, the stats with no max are not", () => {
  // Health 100, Melee 60, Grenade 90, Super 200: nothing meets Super 200, so every other
  // stat's max is 0, and Super's own max (ignoring its target) is 122.
  const result = empty([0, 0, 0, 0, 122, 0]);
  const targets = [0, 100, 0, 90, 200, 60];
  const culprits = overMaxCulprits(result, targets);
  expect(culprits).toEqual([{ stat: 4, max: 122, proven: true }]);
  expect(emptyStatStates(result, culprits)).toEqual(["none", "none", "none", "none", "over", "none"]);
});

test("several culprits: lowering any one is enough, and an unproven max says so", () => {
  // Health 130, Class 110, Grenade 170 on the real pool: maximums 105 / 51 / 140.
  const result = empty([90, 105, 51, 140, 80, 70], [90, 105, 60, 140, 80, 70]);
  const culprits = overMaxCulprits(result, [0, 130, 110, 170, 0, 0]);
  expect(culprits).toEqual([
    { stat: 1, max: 105, proven: true },
    { stat: 2, max: 51, proven: false },
    { stat: 3, max: 140, proven: true },
  ]);
  expect(emptyStatStates(result, culprits)).toEqual([undefined, "over", "over", "over", undefined, undefined]);
});

test("no single stat to blame, and a result with builds, give no culprits", () => {
  expect(overMaxCulprits(empty([0, 0, 0, 0, 0, 0]), [0, 100, 0, 0, 200, 0])).toEqual([]);
  // A target at (not past) its max is not a culprit.
  expect(overMaxCulprits(empty([0, 100, 0, 0, 0, 0]), [0, 100, 0, 0, 0, 0])).toEqual([]);
  const withBuilds = { ...empty([0, 50, 0, 0, 0, 0]), loadouts: [{} as OptimizerOutput["loadouts"][number]] };
  expect(overMaxCulprits(withBuilds, [0, 60, 0, 0, 0, 0])).toEqual([]);
});
