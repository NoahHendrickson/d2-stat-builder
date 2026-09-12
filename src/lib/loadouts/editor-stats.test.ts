import { expect, test } from "vitest";
import { STAT_HASHES } from "../armory/stats";
import { sumEditorStats, withEditorTotals } from "./editor-stats";
import type { SavedLoadoutData } from "./types";

const H = STAT_HASHES;
const inv = (hash: number, stats: { statTypeHash: number; value: number }[]) =>
  hash === 0 ? undefined : stats;

const socket = (index: number, kind: "general" | "other" | "tuning" | "artifice") => ({
  index,
  kind,
  category: kind,
});

test("sums piece stats, placed mods, and fragment bonuses", () => {
  const plugs: Record<number, { statTypeHash: number; value: number }[]> = {
    10: [{ statTypeHash: H.health, value: 10 }],
    20: [
      { statTypeHash: H.weapons, value: 10 },
      { statTypeHash: H.health, value: -10 },
    ],
  };
  const { stats, total } = sumEditorStats(
    [{ instanceId: "helm", stats: [20, 30, 0, 0, 0, 0] }],
    { helm: { 0: 10 } },
    [20],
    0,
    (hash) => inv(hash, plugs[hash] ?? []),
  );
  expect(stats).toEqual([30, 30, 0, 0, 0, 0]);
  expect(total).toBe(60);
});

test("clamps each stat to 0–200", () => {
  const { stats } = sumEditorStats(
    [{ instanceId: "a", stats: [195, 5, 0, 0, 0, 0] }],
    { a: { 0: 1 } },
    [2],
    0,
    (hash) =>
      hash === 1
        ? [{ statTypeHash: H.weapons, value: 10 }]
        : [{ statTypeHash: H.health, value: -10 }],
  );
  expect(stats[0]).toBe(200);
  expect(stats[1]).toBe(0);
});

test("splits placement into Mods/Tuning/Artifice so the breakdown matches the header", () => {
  const { stats, breakdown } = sumEditorStats(
    [
      {
        instanceId: "helm",
        stats: [20, 0, 0, 0, 0, 0],
        armorSockets: [socket(0, "general"), socket(1, "tuning")],
      },
      {
        instanceId: "arms",
        stats: [0, 20, 0, 0, 0, 0],
        armorSockets: [socket(0, "artifice")],
      },
    ],
    {
      helm: { 0: 10, 1: 11 },
      arms: { 0: 12 },
    },
    [],
    0,
    (hash) =>
      hash === 10
        ? [{ statTypeHash: H.weapons, value: 10 }]
        : hash === 11
          ? [
              { statTypeHash: H.weapons, value: 5 },
              { statTypeHash: H.health, value: -5 },
            ]
          : [{ statTypeHash: H.health, value: 3 }],
  );
  expect(stats).toEqual([35, 18, 0, 0, 0, 0]);
  expect(breakdown?.modBonus).toEqual([10, 0, 0, 0, 0, 0]);
  expect(breakdown?.tuningBonus).toEqual([5, -5, 0, 0, 0, 0]);
  expect(breakdown?.artificeBonus).toEqual([0, 3, 0, 0, 0, 0]);
  expect(breakdown?.modsUsed).toEqual({ major: 1, minor: 0 });
  expect(breakdown?.piece.helm.tuning).toEqual({ kind: "directional", plus: 0, minus: 1 });
  expect(breakdown?.piece.arms.artifice).toBe(1);
});

test("withEditorTotals replaces headline totals and the breakdown when present", () => {
  const zero = [0, 0, 0, 0, 0, 0];
  const data: SavedLoadoutData = {
    version: 1,
    loadout: { id: "l", name: "L", classType: 0, equipped: [], unequipped: [], parameters: { mods: [], assumeArmorMasterwork: 0 } },
    optimizer: {
      pieceIds: ["helm"],
      baseStats: [0, 195, 0, 0, 0, 0],
      stats: [0, 200, 0, 0, 0, 0],
      tuningBonus: zero,
      tuning: [null],
      modBonus: [0, 10, 0, 0, 0, 0],
      modsUsed: { major: 1, minor: 0 },
      artificeBonus: zero,
      artifice: [null],
      total: 200,
      exotic: false,
    },
  };
  const next = withEditorTotals(data, {
    stats: [10, 185, 0, 0, 0, 0],
    total: 195,
    breakdown: {
      modBonus: [10, 0, 0, 0, 0, 0],
      tuningBonus: zero as never,
      artificeBonus: zero as never,
      modsUsed: { major: 1, minor: 0 },
      piece: { helm: { tuning: { kind: "balanced" }, artifice: null } },
    },
  });
  expect(next.optimizer?.stats).toEqual([10, 185, 0, 0, 0, 0]);
  expect(next.optimizer?.total).toBe(195);
  expect(next.optimizer?.baseStats).toEqual([0, 195, 0, 0, 0, 0]);
  expect(next.optimizer?.modBonus).toEqual([10, 0, 0, 0, 0, 0]);
  expect(next.optimizer?.tuning).toEqual([{ kind: "balanced" }]);
  expect(withEditorTotals(data, undefined)).toBe(data);
  const noOptimizer: SavedLoadoutData = { version: data.version, loadout: data.loadout };
  expect(withEditorTotals(noOptimizer, { stats: zero as never, total: 0 })).toBe(noOptimizer);
});
