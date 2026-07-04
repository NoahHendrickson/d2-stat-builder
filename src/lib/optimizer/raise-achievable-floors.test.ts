import { describe, expect, test } from "vitest";
import { raiseAchievableFloors } from "./solve";

// `raiseAchievableFloors(floors, stats, modsUsed, mods)` raises each of `floors` to the
// build's final `stats[s]` PLUS the build's spare mod capacity dumped into that one stat,
// clamped to STAT_CAP (200). It mutates `floors` in place and returns whether any rose.
// This is the shared seed/harvest primitive: every raised value is achievable because the
// spare mods could genuinely be socketed into any ONE stat while the others' minimums hold.
describe("raiseAchievableFloors", () => {
  test("dumps spare majors into each stat and reports a rise", () => {
    // Build uses 2 of 5 majors → 3 spare majors = +30 points into any one stat.
    const floors = [0, 0, 0, 0, 0, 0];
    const rose = raiseAchievableFloors(
      floors,
      [50, 40, 0, 0, 0, 0],
      { major: 2, minor: 0 },
      { major: 5, minor: 0 },
    );
    expect(rose).toBe(true);
    expect(floors).toEqual([80, 70, 30, 30, 30, 30]);
  });

  test("counts spare minors too", () => {
    // 1 spare major (+10) and 2 spare minors (+10) = +20 spare.
    const floors = [0, 0, 0, 0, 0, 0];
    const rose = raiseAchievableFloors(
      floors,
      [10, 20, 30, 0, 0, 0],
      { major: 1, minor: 1 },
      { major: 2, minor: 3 },
    );
    expect(rose).toBe(true);
    expect(floors).toEqual([30, 40, 50, 20, 20, 20]);
  });

  test("clamps each floor at STAT_CAP (200)", () => {
    const floors = [0, 0, 0, 0, 0, 0];
    // Stat 0 is already 190; +30 spare would be 220 → clamp to 200.
    const rose = raiseAchievableFloors(
      floors,
      [190, 0, 0, 0, 0, 0],
      { major: 0, minor: 0 },
      { major: 3, minor: 0 },
    );
    expect(rose).toBe(true);
    expect(floors[0]).toBe(200);
  });

  test("no-spare case raises floors to the build's raw stats", () => {
    const floors = [0, 0, 0, 0, 0, 0];
    const rose = raiseAchievableFloors(
      floors,
      [50, 40, 30, 20, 10, 5],
      { major: 3, minor: 2 },
      { major: 3, minor: 2 }, // all mods used → 0 spare
    );
    expect(rose).toBe(true);
    expect(floors).toEqual([50, 40, 30, 20, 10, 5]);
  });

  test("returns false and leaves floors untouched when nothing rises", () => {
    // Existing floors already dominate stats + spare everywhere.
    const floors = [200, 200, 200, 200, 200, 200];
    const before = floors.slice();
    const rose = raiseAchievableFloors(
      floors,
      [50, 40, 30, 20, 10, 5],
      { major: 0, minor: 0 },
      { major: 5, minor: 0 },
    );
    expect(rose).toBe(false);
    expect(floors).toEqual(before);
  });

  test("only-some-floors-rise still reports true and leaves higher floors intact", () => {
    const floors = [100, 0, 0, 0, 0, 0];
    // spare = 1 major = +10. Stat 0: max(100, 30+10=40) → stays 100. Others rise.
    const rose = raiseAchievableFloors(
      floors,
      [30, 20, 0, 0, 0, 0],
      { major: 0, minor: 0 },
      { major: 1, minor: 0 },
    );
    expect(rose).toBe(true);
    expect(floors).toEqual([100, 30, 10, 10, 10, 10]);
  });
});
