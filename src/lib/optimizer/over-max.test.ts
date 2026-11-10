import { describe, expect, test } from "vitest";
import type { ShownResult } from "./optimizer-store";
import { isSettledEmpty, overMaxCulprits, overMaxState } from "./over-max";
import type { OptimizerOutput, RefinementState } from "./types";

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
const BUILD = {} as OptimizerOutput["loadouts"][number];
const IDLE: RefinementState = { phase: "idle" };
const done = (over: Partial<Extract<RefinementState, { phase: "done" }>> = {}): RefinementState => ({
  phase: "done",
  outcome: null,
  pending: null,
  verified: true,
  ...over,
});

// [weapons, health, class, grenade, super, melee]
describe("overMaxCulprits", () => {
  test("one target past its max is the culprit; the stats with no max are not", () => {
    // Health 100, Melee 60, Grenade 90, Super 200: nothing meets Super 200, so every
    // other stat's max is 0, and Super's own max (ignoring its target) is 122.
    expect(overMaxCulprits(empty([0, 0, 0, 0, 122, 0]), [0, 100, 0, 90, 200, 60])).toEqual([
      { stat: 4, max: 122, proven: true },
    ]);
  });

  test("several culprits: lowering any one is enough, and an unproven max says so", () => {
    // Health 130, Class 110, Grenade 170 on the real pool: maximums 105 / 51 / 140.
    const result = empty([90, 105, 51, 140, 80, 70], [90, 105, 60, 140, 80, 70]);
    expect(overMaxCulprits(result, [0, 130, 110, 170, 0, 0])).toEqual([
      { stat: 1, max: 105, proven: true },
      { stat: 2, max: 51, proven: false },
      { stat: 3, max: 140, proven: true },
    ]);
  });

  test("no single stat to blame, and a result with builds, give no culprits", () => {
    expect(overMaxCulprits(empty([0, 0, 0, 0, 0, 0]), [0, 100, 0, 0, 200, 0])).toEqual([]);
    // A target at (not past) its max is not a culprit.
    expect(overMaxCulprits(empty([0, 100, 0, 0, 0, 0]), [0, 100, 0, 0, 0, 0])).toEqual([]);
    const withBuilds = { ...empty([0, 50, 0, 0, 0, 0]), loadouts: [BUILD] };
    expect(overMaxCulprits(withBuilds, [0, 60, 0, 0, 0, 0])).toEqual([]);
  });
});

describe("isSettledEmpty", () => {
  test("an exhaustive empty walk is settled; one with builds never is", () => {
    expect(isSettledEmpty(empty([0, 0, 0, 0, 0, 0]), IDLE)).toBe(true);
    expect(isSettledEmpty({ ...empty([0, 0, 0, 0, 0, 0]), loadouts: [BUILD] }, IDLE)).toBe(false);
  });

  test("a capped walk proved nothing until a background pass verifies it", () => {
    const capped = { ...empty([0, 0, 0, 0, 0, 0]), capped: true };
    expect(isSettledEmpty(capped, IDLE)).toBe(false);
    expect(isSettledEmpty(capped, done({ verified: false }))).toBe(false);
    expect(isSettledEmpty(capped, done())).toBe(true);
  });

  test("not while the background pass runs, nor with a better list waiting", () => {
    const result = empty([0, 0, 0, 0, 122, 0]);
    const running: RefinementState = { phase: "running", progress: 0, interim: result, pending: null };
    expect(isSettledEmpty(result, running)).toBe(false);
    expect(isSettledEmpty(result, done({ pending: { ...result, loadouts: [BUILD] } }))).toBe(false);
  });
});

describe("overMaxState", () => {
  const TARGETS = [0, 100, 0, 90, 200, 60];
  const shown = (result: OptimizerOutput, targets = TARGETS, classType = 1): ShownResult => ({
    final: true,
    result,
    origin: { targets, classType },
    key: "k",
    input: { slots: [], minimums: targets },
  });
  const base = {
    shown: shown(empty([0, 0, 0, 0, 122, 0])),
    refinement: IDLE,
    running: false,
    failed: false,
    classType: 1,
    targets: TARGETS,
  };

  test("marks the culprit row with its max, and the rows the other targets leave no max", () => {
    expect(overMaxState(base)).toEqual({
      culprits: [{ stat: 4, max: 122, proven: true }],
      rows: [
        { kind: "none" },
        { kind: "none" },
        { kind: "none" },
        { kind: "none" },
        { kind: "over", max: 122 },
        { kind: "none" },
      ],
    });
  });

  test("nothing while a search runs, after a crash, or with no result", () => {
    expect(overMaxState({ ...base, running: true })).toBeNull();
    expect(overMaxState({ ...base, failed: true })).toBeNull();
    expect(overMaxState({ ...base, shown: null })).toBeNull();
  });

  test("nothing from a list whose maximums aren't in, or one that isn't settled", () => {
    const early: ShownResult = {
      ...base.shown,
      final: false,
      result: { loadouts: [BUILD], combosTried: 1, combosValid: 1, combosValidExact: true, capped: false },
    };
    expect(overMaxState({ ...base, shown: early })).toBeNull();
    const interim = base.shown.result as OptimizerOutput;
    const running: RefinementState = { phase: "running", progress: 0, interim, pending: null };
    expect(overMaxState({ ...base, refinement: running })).toBeNull();
    expect(overMaxState({ ...base, shown: shown({ ...interim, capped: true }) })).toBeNull();
  });

  test("nothing once the targets or the class on screen have moved on from the result", () => {
    expect(overMaxState({ ...base, targets: [0, 100, 0, 90, 150, 60] })).toBeNull();
    expect(overMaxState({ ...base, classType: 2 })).toBeNull();
  });

  test("an empty result with no single culprit marks no row \"over\"", () => {
    const state = overMaxState({ ...base, shown: shown(empty([0, 0, 0, 0, 0, 0])) });
    expect(state?.culprits).toEqual([]);
    expect(state?.rows.every((r) => r?.kind === "none")).toBe(true);
  });
});
