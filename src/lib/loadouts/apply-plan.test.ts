import { test, expect, describe } from "vitest";
import { planLoadoutPlugs, type PlanPiece, type PlugInfo } from "./apply-plan";

// Plug catalogue: 10x = major (+10, cost 3), 20x = minor (+5, cost 1), 300 = balanced,
// 31x = directional (+5 to stat x), 40x = artifice, 50x = fragments.
const INFO: Record<number, PlugInfo> = {
  101: { kind: "general", name: "Major A", cost: 3 },
  102: { kind: "general", name: "Major B", cost: 3 },
  201: { kind: "general", name: "Minor A", cost: 1 },
  300: { kind: "tuning", name: "Balanced Tuning", cost: 0 },
  311: { kind: "tuning", name: "Tune +1", cost: 0, tunedPlus: 1 },
  314: { kind: "tuning", name: "Tune +4", cost: 0, tunedPlus: 4 },
  401: { kind: "artifice", name: "Artifice +3", cost: 0 },
  501: { kind: "other", name: "Fragment One", cost: 0 },
  502: { kind: "other", name: "Fragment Two", cost: 0 },
  503: { kind: "other", name: "Fragment Three", cost: 0 },
  999: { kind: "other", name: "Shader", cost: 0 },
};
const plugInfo = (h: number) => INFO[h];

const piece = (over: Partial<PlanPiece> & { instanceId: string }): PlanPiece => ({
  name: over.instanceId,
  modSockets: { general: 1, tuning: 11 },
  energy: { capacity: 10, used: 0 },
  ...over,
});

describe("general stat mods", () => {
  test("costliest first onto the piece with the most free energy; no-ops detected", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "full", energy: { capacity: 10, used: 9 } }),
        piece({ instanceId: "has-major", socketPlugs: { 1: 101 }, energy: { capacity: 10, used: 3 } }),
        piece({ instanceId: "empty" }),
      ],
      modHashes: [201, 101, 102],
      plugInfo,
    });
    expect(plan.alreadyApplied).toEqual(["Major A → has-major"]);
    expect(plan.plugs.map((p) => [p.plugItemHash, p.itemInstanceId, p.socketIndex])).toEqual([
      [102, "empty", 1],
      [201, "full", 1],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("replacing the current general mod frees its energy", () => {
    // 9 used of which 3 is the socketed major → replacing it with another major fits.
    const plan = planLoadoutPlugs({
      pieces: [piece({ instanceId: "p", socketPlugs: { 1: 101 }, energy: { capacity: 10, used: 9 } })],
      modHashes: [102],
      plugInfo,
    });
    expect(plan.plugs).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  test("skips with a clear reason when nothing fits or no socket exists", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "tight", energy: { capacity: 10, used: 8 } }),
        piece({ instanceId: "no-socket", modSockets: {} }),
      ],
      modHashes: [101, 102, 7],
      plugInfo,
    });
    expect(plan.plugs).toEqual([]);
    expect(plan.skipped).toEqual([
      "Unknown mod #7",
      "Major A: not enough armor energy — remove other mods first",
      "Major B: not enough armor energy — remove other mods first",
    ]);
  });
});

describe("tuning + artifice", () => {
  test("directional goes to the matching tuned stat, exotics are flexible, balanced fills the rest", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "t1", tunedStat: 1 }),
        piece({ instanceId: "exo", tunedStat: 0, flexibleTuning: true }),
        piece({ instanceId: "t4", tunedStat: 4 }),
        piece({ instanceId: "art", modSockets: { general: 1, artifice: 12 } }),
      ],
      modHashes: [300, 314, 311, 300, 401, 401],
      plugInfo,
    });
    const byHash = (h: number) => plan.plugs.filter((p) => p.plugItemHash === h).map((p) => p.itemInstanceId);
    expect(byHash(314)).toEqual(["t4"]);
    expect(byHash(311)).toEqual(["t1"]);
    expect(byHash(300)).toEqual(["exo"]);
    expect(byHash(401)).toEqual(["art"]);
    expect(plan.skipped).toEqual([
      "Balanced Tuning: no tunable piece left",
      "Artifice +3: no artifice piece left",
    ]);
  });

  test("a directional with no matching piece falls back to a flexible exotic", () => {
    const plan = planLoadoutPlugs({
      pieces: [piece({ instanceId: "exo", tunedStat: 0, flexibleTuning: true })],
      modHashes: [314],
      plugInfo,
    });
    expect(plan.plugs[0].itemInstanceId).toBe("exo");
  });
});

describe("fragments", () => {
  test("keeps present fragments, replaces unwanted ones lowest-index first", () => {
    const plan = planLoadoutPlugs({
      pieces: [],
      modHashes: [],
      plugInfo,
      subclass: {
        instanceId: "sub",
        socketStart: 7,
        socketCount: 4,
        fragmentSockets: { 7: 999, 8: 501, 9: 0 },
        desiredFragments: [501, 502, 503],
      },
    });
    expect(plan.alreadyApplied).toEqual(["Fragment One → subclass"]);
    expect(plan.plugs.map((p) => [p.socketIndex, p.plugItemHash])).toEqual([
      [7, 502],
      [9, 503],
    ]);
  });

  test("reports fragments that don't fit", () => {
    const plan = planLoadoutPlugs({
      pieces: [],
      modHashes: [],
      plugInfo,
      subclass: {
        instanceId: "sub",
        socketStart: 7,
        socketCount: 1,
        fragmentSockets: {},
        desiredFragments: [501, 502],
      },
    });
    expect(plan.plugs).toHaveLength(1);
    expect(plan.skipped).toEqual(["Fragment Two: no fragment socket left"]);
  });
});

test("non-armor mods are reported, not applied", () => {
  const plan = planLoadoutPlugs({ pieces: [piece({ instanceId: "p" })], modHashes: [999], plugInfo });
  expect(plan.plugs).toEqual([]);
  expect(plan.skipped).toEqual(["Shader: not an armor mod this app can apply"]);
});
