import { expect, test } from "vitest";
import { STAT_HASHES } from "../armory/stats";
import { sumEditorStats, withEditorTotals } from "./editor-stats";
import type { SavedLoadoutData } from "./types";

const H = STAT_HASHES;
const inv = (hash: number, stats: { statTypeHash: number; value: number }[]) =>
  hash === 0 ? undefined : stats;

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

test("withEditorTotals replaces only the displayed totals, and only when it has them", () => {
  const zero = [0, 0, 0, 0, 0, 0];
  const data: SavedLoadoutData = {
    version: 1,
    loadout: { id: "l", name: "L", classType: 0, equipped: [], unequipped: [], parameters: { mods: [], assumeArmorMasterwork: 0 } },
    optimizer: { pieceIds: [], baseStats: [0, 195, 0, 0, 0, 0], stats: [0, 200, 0, 0, 0, 0], tuningBonus: zero, tuning: [], modBonus: zero, modsUsed: { major: 0, minor: 0 }, artificeBonus: zero, artifice: [], total: 200, exotic: false },
  };
  const next = withEditorTotals(data, { stats: [10, 185, 0, 0, 0, 0], total: 195 });
  expect(next.optimizer?.stats).toEqual([10, 185, 0, 0, 0, 0]);
  expect(next.optimizer?.total).toBe(195);
  expect(next.optimizer?.baseStats).toEqual([0, 195, 0, 0, 0, 0]);
  expect(withEditorTotals(data, undefined)).toBe(data);
  const noOptimizer: SavedLoadoutData = { version: data.version, loadout: data.loadout };
  expect(withEditorTotals(noOptimizer, { stats: zero as never, total: 0 })).toBe(noOptimizer);
});
