import { test, expect, describe } from "vitest";
import { planLoadoutPlugs, type PlanPiece, type PlanSocket, type PlugInfo } from "./apply-plan";

// Plug catalogue: 10x = major (+10, cost 3), 20x = minor (+5, cost 1), 300 = balanced,
// 31x = directional (+5 to stat x), 40x = artifice, 50x = fragments, 6xx = slot mods.
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
  601: { kind: "other", name: "Helmet Mod", cost: 4 },
  602: { kind: "other", name: "Arms Mod", cost: 2 },
  999: { kind: "other", name: "Shader", cost: 0 },
};
const plugInfo = (h: number) => INFO[h];
const EMPTY_GENERAL = 9001;
const EMPTY_HELMET = 9002;

const general = (current = EMPTY_GENERAL): PlanSocket => ({ index: 1, kind: "general", current });
const tuning = (): PlanSocket => ({ index: 11, kind: "tuning" });
const helmetSlot = (current = EMPTY_HELMET): PlanSocket => ({
  index: 2,
  kind: "other",
  current,
  accepts: new Set([601, EMPTY_HELMET]),
});

const piece = (over: Partial<PlanPiece> & { instanceId: string }): PlanPiece => ({
  name: over.instanceId,
  sockets: [general(), tuning()],
  energy: { capacity: 10, used: 0 },
  ...over,
});

describe("general stat mods", () => {
  test("costliest first onto the piece with the most free energy; no-ops detected", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "full", energy: { capacity: 10, used: 9 } }),
        piece({ instanceId: "has-major", sockets: [general(101)], energy: { capacity: 10, used: 3 } }),
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
    expect(plan.placement).toEqual({
      full: { 1: 201, 11: undefined },
      "has-major": { 1: 101 },
      empty: { 1: 102, 11: undefined },
    });
  });

  test("replacing the current general mod frees its energy", () => {
    // 9 used of which 3 is the socketed major → replacing it with another major fits.
    const plan = planLoadoutPlugs({
      pieces: [piece({ instanceId: "p", sockets: [general(101)], energy: { capacity: 10, used: 9 } })],
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
        piece({ instanceId: "no-socket", sockets: [] }),
      ],
      modHashes: [101, 102, 7],
      plugInfo,
    });
    expect(plan.plugs).toEqual([]);
    expect(plan.skipped).toEqual([
      "Unknown mod #7",
      "Major A: no free mod socket with enough energy — remove other mods first",
      "Major B: no free mod socket with enough energy — remove other mods first",
    ]);
  });
});

describe("slot-specific mods + placements", () => {
  test("a slot mod only goes where its plug set accepts it, and shares energy with the stat mod", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "helmet", sockets: [general(), helmetSlot()] }),
        piece({ instanceId: "arms", sockets: [general(), { index: 2, kind: "other", accepts: new Set([602]) }] }),
      ],
      modHashes: [601, 101, 102],
      plugInfo,
    });
    const at = (id: string, idx: number) => plan.plugs.find((p) => p.itemInstanceId === id && p.socketIndex === idx)?.plugItemHash;
    expect(at("helmet", 2)).toBe(601); // helmet mod (cost 4)
    // Majors (3 each): helmet has 6 free after the helmet mod → one fits; arms takes the other.
    expect([at("helmet", 1), at("arms", 1)].sort()).toEqual([101, 102]);
    expect(plan.skipped).toEqual([]);
  });

  test("energy overflow on one piece skips the mod that doesn't fit", () => {
    const plan = planLoadoutPlugs({
      pieces: [piece({ instanceId: "helmet", sockets: [general(), helmetSlot()], energy: { capacity: 6, used: 0 } })],
      modHashes: [601, 101],
      plugInfo,
    });
    expect(plan.plugs.map((p) => p.plugItemHash)).toEqual([601]);
    expect(plan.skipped).toEqual([
      "Major A: no free mod socket with enough energy — remove other mods first",
    ]);
  });

  test("explicit placements win over auto-placement", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "a", energy: { capacity: 10, used: 5 } }),
        piece({ instanceId: "b" }), // more free energy — auto would pick this
      ],
      modHashes: [101],
      plugInfo,
      placements: { a: { 1: 101 } },
    });
    expect(plan.plugs.map((p) => p.itemInstanceId)).toEqual(["a"]);
  });

  test("a placement that no longer fits falls back to auto-placement", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "a", energy: { capacity: 10, used: 9 } }),
        piece({ instanceId: "b" }),
      ],
      modHashes: [101],
      plugInfo,
      placements: { a: { 1: 101 }, gone: { 1: 101 } },
    });
    expect(plan.plugs.map((p) => p.itemInstanceId)).toEqual(["b"]);
  });
});

describe("tuning + artifice", () => {
  test("directional goes to the matching tuned stat, exotics are flexible, balanced fills the rest", () => {
    const plan = planLoadoutPlugs({
      pieces: [
        piece({ instanceId: "t1", tunedStat: 1 }),
        piece({ instanceId: "exo", tunedStat: 0, flexibleTuning: true }),
        piece({ instanceId: "t4", tunedStat: 4 }),
        piece({ instanceId: "art", sockets: [general(), { index: 12, kind: "artifice" }] }),
      ],
      modHashes: [300, 314, 311, 300, 401, 401],
      plugInfo,
    });
    const byHash = (h: number) => plan.plugs.filter((p) => p.plugItemHash === h).map((p) => p.itemInstanceId);
    expect(byHash(314)).toEqual(["t4"]);
    expect(byHash(311)).toEqual(["t1"]);
    expect(byHash(300)).toEqual(["exo"]);
    expect(byHash(401)).toEqual(["art"]);
    // The second artifice mod has zero candidates once the first is placed, so it is
    // reported before the leftover Balanced Tuning.
    expect(plan.skipped).toEqual([
      "Artifice +3: no artifice piece left",
      "Balanced Tuning: no tunable piece left",
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

test("a mod no socket accepts is reported, not applied", () => {
  const plan = planLoadoutPlugs({
    pieces: [piece({ instanceId: "p", sockets: [general(), helmetSlot()] })],
    modHashes: [999],
    plugInfo,
  });
  expect(plan.plugs).toEqual([]);
  expect(plan.skipped).toEqual(["Shader: no socket on this armor takes it (or not enough energy)"]);
});
