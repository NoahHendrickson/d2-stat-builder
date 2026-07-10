import { expect, test } from "vitest";
import type { OptimizerLoadout } from "../optimizer/types";
import {
  DEFAULT_LOADOUT_SORT,
  LOADOUT_SORT_OPTIONS,
  loadoutSortLabel,
  sortLoadouts,
  type LoadoutSortState,
} from "./sort-loadouts";

function loadout(
  partial: Partial<OptimizerLoadout> & {
    stats: OptimizerLoadout["stats"];
    total: number;
  },
): OptimizerLoadout {
  return {
    pieceIds: partial.pieceIds ?? ["a", "b", "c", "d", "e"],
    baseStats: partial.baseStats ?? partial.stats,
    stats: partial.stats,
    tuningBonus: partial.tuningBonus ?? [0, 0, 0, 0, 0, 0],
    tuning: partial.tuning ?? [null, null, null, null, null],
    modBonus: partial.modBonus ?? [0, 0, 0, 0, 0, 0],
    modsUsed: partial.modsUsed ?? { major: 0, minor: 0 },
    artificeBonus: partial.artificeBonus ?? [0, 0, 0, 0, 0, 0],
    artifice: partial.artifice ?? [null, null, null, null, null],
    total: partial.total,
    exotic: partial.exotic ?? false,
  };
}

const sample: OptimizerLoadout[] = [
  // STAT_ORDER: weapons, health, class, grenade, super, melee
  loadout({
    pieceIds: ["high-total"],
    stats: [100, 100, 80, 60, 70, 90],
    total: 500,
  }),
  loadout({
    pieceIds: ["high-grenade"],
    stats: [70, 80, 90, 150, 60, 50],
    total: 500,
  }),
  loadout({
    pieceIds: ["mid"],
    stats: [90, 90, 100, 100, 80, 70],
    total: 530,
  }),
  loadout({
    pieceIds: ["low"],
    stats: [50, 50, 50, 40, 50, 50],
    total: 290,
  }),
];

test("default sort is total descending", () => {
  expect(DEFAULT_LOADOUT_SORT).toEqual({ key: "total", asc: false });
});

test("sort options list Total then display-order stats", () => {
  expect(LOADOUT_SORT_OPTIONS.map((o) => o.key)).toEqual([
    "total",
    "health",
    "melee",
    "grenade",
    "super",
    "class",
    "weapons",
  ]);
  expect(loadoutSortLabel("grenade")).toBe("Grenade");
  expect(loadoutSortLabel("total")).toBe("Total");
});

test("sort by total descending matches solver default order for distinct totals", () => {
  const sorted = sortLoadouts(sample, { key: "total", asc: false });
  expect(sorted.map((l) => l.pieceIds[0])).toEqual([
    "mid",
    "high-total",
    "high-grenade",
    "low",
  ]);
});

test("sort by grenade descending puts highest grenade first", () => {
  const sorted = sortLoadouts(sample, { key: "grenade", asc: false });
  expect(sorted.map((l) => l.stats[3])).toEqual([150, 100, 60, 40]);
  expect(sorted[0]!.pieceIds[0]).toBe("high-grenade");
});

test("sort by class ascending puts lowest class first", () => {
  const sorted = sortLoadouts(sample, { key: "class", asc: true });
  expect(sorted.map((l) => l.stats[2])).toEqual([50, 80, 90, 100]);
});

test("ties keep original relative order (stable)", () => {
  const sort: LoadoutSortState = { key: "total", asc: false };
  // high-total and high-grenade both total 500; original order preserved.
  const sorted = sortLoadouts(sample, sort);
  const tied = sorted.filter((l) => l.total === 500);
  expect(tied.map((l) => l.pieceIds[0])).toEqual([
    "high-total",
    "high-grenade",
  ]);
});

test("does not mutate the input array", () => {
  const copy = [...sample];
  sortLoadouts(sample, { key: "melee", asc: true });
  expect(sample).toEqual(copy);
});
