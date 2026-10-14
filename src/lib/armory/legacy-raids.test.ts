import { describe, expect, test } from "vitest";
import {
  LEGACY_RAIDS,
  isLegacyRaidSetHash,
  legacyRaidOf,
  legacyRaidSetHash,
  makeableRaidReqs,
  ownedLegacyRaids,
  parseRaidReqs,
  raidSetRequirements,
} from "./legacy-raids";
import { inDefaultOptimizerPool } from "./optimizer-pool";
import { armorToOptimizerPiece } from "../optimizer/from-armory";
import { solve } from "../optimizer/solve";
import type { ArmorPiece } from "./normalize";
import type { ArmorSlot, StatArray } from "./stats";

// Plug hash → category, the shape of the live manifest: Deep Stone Crypt's "Empty Mod
// Socket" sits at socket 11 among general / shader / ornament entries.
const CATEGORIES: Record<number, string> = {
  1: "enhancements.v2_general",
  2: "shader",
  3: "enhancements.raid_descent",
  4: "enhancements.raid_v600",
  5: "enhancements.season_outlaw",
};
const category = (h: number) => CATEGORIES[h];
const entries = (...hashes: number[]) => ({
  sockets: { socketEntries: hashes.map((h) => ({ singleInitialItemHash: h })) },
});

describe("legacyRaidOf", () => {
  test("reads the raid from the raid mod socket's initial plug", () => {
    expect(legacyRaidOf(entries(1, 1, 2, 0, 3), category)).toBe("dsc");
    expect(legacyRaidOf(entries(1, 4), category)).toBe("vow");
  });

  test("ignores pieces with no raid socket, including seasonal activity sockets", () => {
    expect(legacyRaidOf(entries(1, 2), category)).toBeUndefined();
    expect(legacyRaidOf(entries(1, 5), category)).toBeUndefined();
    expect(legacyRaidOf({}, category)).toBeUndefined();
  });
});

test("stand-in set hashes are distinct and never a real (unsigned) set hash", () => {
  const hashes = LEGACY_RAIDS.map((r) => legacyRaidSetHash(r.key));
  expect(new Set(hashes).size).toBe(LEGACY_RAIDS.length);
  expect(hashes.every(isLegacyRaidSetHash)).toBe(true);
  expect(isLegacyRaidSetHash(1490136267)).toBe(false);
});

describe("ownedLegacyRaids", () => {
  test("counts pieces and the slots they cover, in release order", () => {
    const raids = ownedLegacyRaids([
      { legacyRaid: "vow", slot: "helmet", name: "Resonant Fury Mask", icon: "/v.jpg" },
      { legacyRaid: "dsc", slot: "helmet", name: "Legacy's Oath Mask", icon: "/m.jpg" },
      { legacyRaid: "dsc", slot: "helmet", name: "Legacy's Oath Mask" },
      { legacyRaid: "dsc", slot: "chest", name: "Legacy's Oath Vest", watermark: "/w.png" },
      { slot: "legs", name: "Something else" },
    ]);
    expect(raids).toEqual([
      {
        key: "dsc",
        name: "Deep Stone Crypt",
        ownedCount: 3,
        slotCount: 2,
        slots: {
          helmet: { name: "Legacy's Oath Mask", icon: "/m.jpg" },
          chest: { name: "Legacy's Oath Vest", watermark: "/w.png" },
        },
      },
      {
        key: "vow",
        name: "Vow of the Disciple",
        ownedCount: 1,
        slotCount: 1,
        slots: { helmet: { name: "Resonant Fury Mask", icon: "/v.jpg" } },
      },
    ]);
  });
});

describe("makeableRaidReqs", () => {
  const raids = ownedLegacyRaids([
    { legacyRaid: "dsc", slot: "helmet", name: "Legacy's Oath Mask" },
    { legacyRaid: "dsc", slot: "chest", name: "Legacy's Oath Vest" },
  ]);

  test("keeps the same object when every requirement can be made", () => {
    const reqs = { dsc: 2 };
    expect(makeableRaidReqs(reqs, raids)).toBe(reqs);
  });

  test("caps a count at the covered slots and drops raids with no armor", () => {
    expect(makeableRaidReqs({ dsc: 4, kf: 1 }, raids)).toEqual({ dsc: 2 });
  });
});

test("parseRaidReqs keeps known raids with a count of 1–5", () => {
  expect(parseRaidReqs({ dsc: 2, vow: 5, kf: 0, se: 6, ron: 1.5, nope: 1 })).toEqual({
    dsc: 2,
    vow: 5,
  });
  expect(parseRaidReqs(undefined)).toEqual({});
  expect(parseRaidReqs([1])).toEqual({});
});

describe("in the optimizer", () => {
  const off = { legacyExotics: false, lowerTierArmor: false, legacyArmor: false };

  test("a required raid's legacy legendaries join the pool, other legacy armor doesn't", () => {
    const dsc = { isFestivalMask: false, isExotic: false, legacyRaid: "dsc" };
    const vow = { isFestivalMask: false, isExotic: false, legacyRaid: "vow" };
    const plain = { isFestivalMask: false, isExotic: false };
    const opts = { ...off, legacyRaids: new Set(["dsc"]) };
    expect(inDefaultOptimizerPool(dsc, opts)).toBe(true);
    expect(inDefaultOptimizerPool(vow, opts)).toBe(false);
    expect(inDefaultOptimizerPool(plain, opts)).toBe(false);
    expect(inDefaultOptimizerPool(dsc, off)).toBe(false);
  });

  /** An untuned armory piece; `legacyRaid` marks it as that raid's armor. */
  function armor(id: string, slot: ArmorSlot, stats: StatArray, legacyRaid?: "dsc"): ArmorPiece {
    return {
      instanceId: id,
      itemHash: 0,
      name: id,
      slot,
      classType: 1,
      isExotic: false,
      isArtifice: false,
      isFestivalMask: false,
      baseStats: stats,
      stats,
      location: "vault",
      ...(legacyRaid ? { legacyRaid } : {}),
    };
  }

  test("a raid requirement makes every build wear that many of its pieces", () => {
    const slots: ArmorSlot[] = ["helmet", "arms", "chest", "legs", "classItem"];
    const strong: StatArray = [30, 30, 30, 0, 0, 0];
    const weak: StatArray = [10, 10, 10, 0, 0, 0];
    const pieces = slots.flatMap((slot, i) => [
      armor(`t${i}`, slot, strong),
      ...(i < 3 ? [armor(`dsc${i}`, slot, weak, "dsc")] : []),
    ]);
    const optimizerSlots = slots.map((slot) =>
      pieces.filter((p) => p.slot === slot).map(armorToOptimizerPiece),
    );
    const base = {
      slots: optimizerSlots,
      minimums: [0, 0, 0, 0, 0, 0],
      mods: { major: 0, minor: 0 },
      allowTuning: false,
    };

    const free = solve(base);
    expect(free.loadouts[0].pieceIds.some((id) => id.startsWith("dsc"))).toBe(false);

    const out = solve({ ...base, setRequirements: raidSetRequirements({ dsc: 2 }) });
    expect(out.loadouts.length).toBeGreaterThan(0);
    for (const l of out.loadouts) {
      expect(l.pieceIds.filter((id) => id.startsWith("dsc")).length).toBeGreaterThanOrEqual(2);
    }
  });
});
