import { describe, expect, test } from "vitest";
import {
  LEGACY_RAIDS,
  armorGroupOf,
  legacyRaidForCategory,
  legacyRaidOf,
  legacyRaidSetHash,
  makeableRaidReqs,
  ownedLegacyRaids,
  parseRaidReqs,
  raidCountConflict,
  raidSetRequirements,
  requiredLegacyRaids,
  type LegacyRaidKey,
} from "./legacy-raids";
import { inDefaultOptimizerPool } from "./optimizer-pool";
import { armorToOptimizerPiece } from "../optimizer/from-armory";
import { solve } from "../optimizer/solve";
import { isSyntheticSetHash, syntheticSetIndex } from "../optimizer/synthetic-set";
import type { ArmorPiece } from "./normalize";
import type { ArmorSlot, StatArray } from "./stats";

// Plug hashes from the live manifest (2026-10): Deep Stone Crypt's and Vow's "Empty Mod
// Socket", Last Wish's (Hood of the Great Hunt's socket 11), and Dreambane's Nightmare
// socket, which is an activity socket and not a raid's.
const plugs = {
  general: 1,
  dsc: 4055462131,
  vow: 2447143568,
  lastWish: 1679876242,
  dreambane: 3,
};
const CATEGORIES: Record<number, string> = {
  [plugs.general]: "enhancements.v2_general",
  [plugs.dsc]: "enhancements.raid_descent",
  [plugs.vow]: "enhancements.raid_v600",
  [plugs.lastWish]: "enhancements.season_outlaw",
  [plugs.dreambane]: "enhancements.season_maverick",
};
const raidByPlug = new Map(
  Object.entries(CATEGORIES).flatMap(([h, cat]) => {
    const raid = legacyRaidForCategory(cat);
    return raid ? [[Number(h), raid] as const] : [];
  }),
);
const entries = (...hashes: number[]) => ({
  sockets: { socketEntries: hashes.map((h) => ({ singleInitialItemHash: h })) },
});

describe("legacyRaidOf", () => {
  test("reads the raid from the raid mod socket's initial plug", () => {
    expect(legacyRaidOf(entries(plugs.general, 0, plugs.dsc), raidByPlug)).toBe("dsc");
    expect(legacyRaidOf(entries(plugs.general, plugs.vow), raidByPlug)).toBe("vow");
  });

  test("Last Wish's raid socket counts, though its category reads like a seasonal one", () => {
    expect(legacyRaidOf(entries(plugs.general, plugs.lastWish), raidByPlug)).toBe("lw");
  });

  test("ignores pieces with no raid socket, including activity sockets like Dreambane's", () => {
    expect(legacyRaidOf(entries(plugs.general), raidByPlug)).toBeUndefined();
    expect(legacyRaidOf(entries(plugs.general, plugs.dreambane), raidByPlug)).toBeUndefined();
    expect(legacyRaidOf({}, raidByPlug)).toBeUndefined();
  });
});

describe("raid set hashes", () => {
  test("are distinct synthetic sets, never a real (unsigned) set hash", () => {
    const hashes = LEGACY_RAIDS.map((r) => legacyRaidSetHash(r.key));
    expect(new Set(hashes).size).toBe(LEGACY_RAIDS.length);
    expect(hashes.every(isSyntheticSetHash)).toBe(true);
    expect(isSyntheticSetHash(1490136267)).toBe(false);
  });

  test("come from each raid's fixed id, not its place in the list (build usage stores them)", () => {
    // Pinned: changing any of these re-keys stored build-usage history.
    expect(Object.fromEntries(LEGACY_RAIDS.map((r) => [r.key, legacyRaidSetHash(r.key)]))).toEqual({
      garden: -1,
      dsc: -2,
      vog: -3,
      vow: -4,
      kf: -5,
      ron: -6,
      crota: -7,
      se: -8,
      lw: -9,
    });
    expect(LEGACY_RAIDS.map((r) => syntheticSetIndex(legacyRaidSetHash(r.key)))).toEqual(
      LEGACY_RAIDS.map((r) => r.id),
    );
  });

  test("requiredLegacyRaids reads the raids back out of a query's set requirements", () => {
    const reqs = [...raidSetRequirements({ dsc: 2, lw: 1 }), { setHash: 1490136267, count: 2 }];
    expect(requiredLegacyRaids(reqs)).toEqual(new Set(["dsc", "lw"]));
    expect(requiredLegacyRaids(undefined)).toEqual(new Set());
  });
});

describe("armorGroupOf", () => {
  test("a manifest set badges from 2 pieces, a legacy raid from 1, by name", () => {
    expect(armorGroupOf({ setHash: 1490136267 })).toEqual({ setHash: 1490136267, minBadge: 2 });
    expect(armorGroupOf({ legacyRaid: "dsc" })).toEqual({
      setHash: legacyRaidSetHash("dsc"),
      minBadge: 1,
      name: "Deep Stone Crypt raid armor",
      raid: "dsc",
    });
    expect(armorGroupOf({})).toBeUndefined();
  });
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
  const off = {
    legacyExotics: false,
    lowerTierArmor: false,
    legacyArmor: false,
    legacyRaids: new Set<LegacyRaidKey>(),
  };

  test("a required raid's legacy legendaries join the pool, other legacy armor doesn't", () => {
    const dsc = { isFestivalMask: false, isExotic: false, legacyRaid: "dsc" as const };
    const vow = { isFestivalMask: false, isExotic: false, legacyRaid: "vow" as const };
    const plain = { isFestivalMask: false, isExotic: false };
    const opts = { ...off, legacyRaids: new Set<LegacyRaidKey>(["dsc"]) };
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

  test("raid pieces join their raid's set only while that raid is required", () => {
    const piece = armor("d", "helmet", [10, 10, 10, 0, 0, 0], "dsc");
    expect(armorToOptimizerPiece(piece, new Set()).setHash).toBeUndefined();
    expect(armorToOptimizerPiece(piece, new Set<LegacyRaidKey>(["vow"])).setHash).toBeUndefined();
    expect(armorToOptimizerPiece(piece, new Set<LegacyRaidKey>(["dsc"])).setHash).toBe(
      legacyRaidSetHash("dsc"),
    );
  });

  test("a raid requirement makes every build wear that many of its pieces", () => {
    const slots: ArmorSlot[] = ["helmet", "arms", "chest", "legs", "classItem"];
    const strong: StatArray = [30, 30, 30, 0, 0, 0];
    const weak: StatArray = [10, 10, 10, 0, 0, 0];
    const pieces = slots.flatMap((slot, i) => [
      armor(`t${i}`, slot, strong),
      ...(i < 3 ? [armor(`dsc${i}`, slot, weak, "dsc")] : []),
    ]);
    const required = new Set<LegacyRaidKey>(["dsc"]);
    const optimizerSlots = slots.map((slot) =>
      pieces.filter((p) => p.slot === slot).map((p) => armorToOptimizerPiece(p, required)),
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

describe("raidCountConflict", () => {
  // DSC: helmet + chest. Vow: helmet + chest. KF: legs.
  const raids = ownedLegacyRaids([
    { legacyRaid: "dsc", slot: "helmet", name: "Legacy's Oath Mask" },
    { legacyRaid: "dsc", slot: "chest", name: "Legacy's Oath Vest" },
    { legacyRaid: "vow", slot: "helmet", name: "Resonant Fury Mask" },
    { legacyRaid: "vow", slot: "chest", name: "Resonant Fury Vest" },
    { legacyRaid: "kf", slot: "legs", name: "War Numen's Boots" },
  ]);

  test("fits when the raids have slots of their own", () => {
    expect(raidCountConflict({ dsc: 2, kf: 1 }, raids, 2)).toBeNull();
    expect(raidCountConflict({ dsc: 1, vow: 1, kf: 1 }, raids, 0)).toBeNull();
  });

  test("names the raids whose pieces share too few slots", () => {
    // 2 + 2 pieces over the same helmet and chest: four is under five, but can't fit.
    expect(raidCountConflict({ dsc: 2, vow: 2 }, raids, 0)).toEqual({
      kind: "slots",
      raids: ["dsc", "vow"],
    });
    expect(raidCountConflict({ dsc: 2, vow: 1, kf: 1 }, raids, 0)).toEqual({
      kind: "slots",
      raids: ["dsc", "vow"],
    });
  });

  test("counts the reserved pieces against the five", () => {
    expect(raidCountConflict({ dsc: 2, kf: 1 }, raids, 3)).toEqual({ kind: "total", pieces: 6 });
  });
});
