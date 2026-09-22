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
    [{ instanceId: "helm", stats: [20, 30, 0, 0, 0, 0], baseStats: [20, 30, 0, 0, 0, 0] }],
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
    [{ instanceId: "a", stats: [195, 5, 0, 0, 0, 0], baseStats: [195, 0, 0, 0, 0, 0] }],
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
        baseStats: [20, 0, 0, 0, 0, 0],
        armorSockets: [socket(0, "general"), socket(1, "tuning")],
      },
      {
        instanceId: "arms",
        stats: [0, 20, 0, 0, 0, 0],
        baseStats: [0, 20, 0, 0, 0, 0],
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

/**
 * Balanced Tuning's manifest entry lists +1 to all six stats; in-game only the three
 * off-archetype stats move (the normalizer strips it that way — see normalize.test.ts).
 * The editor must re-add it the same way: [30,5,5,20,25,5] → [30,6,6,20,25,6] (93), not
 * [31,6,6,21,26,6] (96). Review finding 2 (2026-09-21).
 */
test("Balanced Tuning adds +1 to the three off-archetype stats only, from the base roll", () => {
  const BAL = 3122197216; // BALANCED_TUNING_PLUG_HASH
  const sixOnes = Object.values(H).map((statTypeHash) => ({ statTypeHash, value: 1 }));
  const { stats, total, breakdown } = sumEditorStats(
    [
      {
        instanceId: "helm",
        // Masterworked roll: archetype weapons/grenade/super = 30/20/25, off-arch = 5.
        stats: [30, 5, 5, 20, 25, 5],
        baseStats: [30, 0, 0, 20, 25, 0],
        armorSockets: [socket(3, "tuning")],
      },
    ],
    { helm: { 3: BAL } },
    [],
    0,
    (hash) => (hash === BAL ? sixOnes : undefined),
  );
  expect(stats).toEqual([30, 6, 6, 20, 25, 6]);
  expect(total).toBe(93);
  expect(breakdown?.tuningBonus).toEqual([0, 1, 1, 0, 0, 1]);
  expect(breakdown?.piece.helm.tuning).toEqual({ kind: "balanced" });
});

test("Balanced Tuning classifies off-archetype stats from the base roll, not the exotic's boosted stats", () => {
  const BAL = 3122197216;
  const sixOnes = Object.values(H).map((statTypeHash) => ({ statTypeHash, value: 1 }));
  // An exotic whose +10 health intrinsic lifts health (base 0) above the archetype's
  // tertiary grenade (base 20 → 20): by `stats` alone grenade would look off-archetype.
  const { stats, breakdown } = sumEditorStats(
    [
      {
        instanceId: "ex",
        stats: [30, 25, 5, 20, 25, 5], // base + MW5 + intrinsic (+20 health, +0 others)
        baseStats: [30, 0, 0, 20, 25, 0],
        armorSockets: [socket(0, "tuning")],
      },
    ],
    { ex: { 0: BAL } },
    [],
    0,
    (hash) => (hash === BAL ? sixOnes : undefined),
  );
  expect(breakdown?.tuningBonus).toEqual([0, 1, 1, 0, 0, 1]);
  expect(stats).toEqual([30, 26, 6, 20, 25, 6]);
});

test("a five-piece Balanced loadout is not overstated by 15", () => {
  const BAL = 3122197216;
  const sixOnes = Object.values(H).map((statTypeHash) => ({ statTypeHash, value: 1 }));
  const pieces = ["h", "a", "c", "l", "k"].map((instanceId) => ({
    instanceId,
    stats: [30, 5, 5, 20, 25, 5] as [number, number, number, number, number, number],
    baseStats: [30, 0, 0, 20, 25, 0] as [number, number, number, number, number, number],
    armorSockets: [socket(1, "tuning")],
  }));
  const placement = Object.fromEntries(pieces.map((p) => [p.instanceId, { 1: BAL }]));
  const { total } = sumEditorStats(pieces, placement, [], 0, (hash) =>
    hash === BAL ? sixOnes : undefined,
  );
  expect(total).toBe(5 * 90 + 5 * 3);
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
      power: null,
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
