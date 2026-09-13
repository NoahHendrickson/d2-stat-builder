import { test, expect, describe } from "vitest";
import {
  LOADOUT_SCHEMA_VERSION,
  loadoutHashtags,
  parseBuilderSnapshot,
  parseDimLoadout,
  parseOptimizerLoadout,
  parseSavedLoadout,
  parseSavedLoadoutData,
} from "./types";

const dim = () => ({
  id: "stat-builder",
  name: "  Cenotaph · Prismatic  ",
  notes: "#pve raid build",
  classType: 2,
  equipped: [
    { id: "6917529", hash: 123 },
    { id: "12345", hash: 999, socketOverrides: { "7": 1, "8": 2 } },
  ],
  unequipped: [],
  parameters: {
    mods: [1, 2, 3],
    exoticArmorHash: 123,
    assumeArmorMasterwork: 3,
    statConstraints: [{ statHash: 392767087, minStat: 100 }],
    setBonuses: { "555": 2 },
    artifactUnlocks: { unlockedItemHashes: [10, 11], seasonNumber: 30 },
  },
});

const optimizer = () => ({
  pieceIds: ["a", "b", "c", "d", "e"],
  baseStats: [1, 2, 3, 4, 5, 6],
  stats: [1, 2, 3, 4, 5, 6],
  tuningBonus: [0, 0, 0, 0, 0, 0],
  tuning: [{ kind: "balanced" }, { kind: "directional", plus: 1, minus: 2 }, null, null, null],
  modBonus: [0, 0, 0, 0, 0, 0],
  modsUsed: { major: 1, minor: 4 },
  artificeBonus: [0, 0, 0, 0, 0, 0],
  artifice: [null, null, 3, null, null],
  total: 21,
  exotic: true,
});

const builder = () => ({
  targets: [0, 100, 0, 0, 0, 0],
  major: 2,
  setReqs: { "555": 2 },
  exoticName: "Cenotaph Mask",
  exoticPerks: [null, 42],
  allowTuning: true,
  balancedTuning: true,
  legacyExotics: false,
  dreamersBond: true,
  festivalMasks: true,
  activeSubclass: "Prismatic",
  fragmentHashes: [1, 2],
});

describe("parseDimLoadout", () => {
  test("accepts the full shape, trims the name, coerces numeric keys", () => {
    const out = parseDimLoadout(dim())!;
    expect(out.name).toBe("Cenotaph · Prismatic");
    expect(out.notes).toBe("#pve raid build");
    expect(out.equipped[1].socketOverrides).toEqual({ 7: 1, 8: 2 });
    expect(out.parameters.setBonuses).toEqual({ 555: 2 });
    expect(out.parameters.artifactUnlocks?.unlockedItemHashes).toEqual([10, 11]);
  });

  test("drops an empty notes field", () => {
    expect(parseDimLoadout({ ...dim(), notes: "" })!.notes).toBeUndefined();
  });

  test("rejects a blank name, bad class, bad set-bonus count, oversized fields", () => {
    expect(parseDimLoadout({ ...dim(), name: "   " })).toBeNull();
    expect(parseDimLoadout({ ...dim(), classType: 7 })).toBeNull();
    const badSet = dim();
    badSet.parameters.setBonuses = { "555": 3 } as never;
    expect(parseDimLoadout(badSet)).toBeNull();
    expect(parseDimLoadout({ ...dim(), name: "x".repeat(121) })).toBeNull();
    expect(parseDimLoadout({ ...dim(), notes: "x".repeat(4001) })).toBeNull();
    const manyMods = dim();
    manyMods.parameters.mods = new Array(41).fill(1);
    expect(parseDimLoadout(manyMods)).toBeNull();
  });

  test("rejects non-integer hashes and unknown item shapes", () => {
    const bad = dim();
    bad.equipped[0] = { id: "x", hash: 1.5 };
    expect(parseDimLoadout(bad)).toBeNull();
    expect(parseDimLoadout({ ...dim(), equipped: "nope" })).toBeNull();
  });
});

describe("parseOptimizerLoadout", () => {
  test("round-trips", () => {
    expect(parseOptimizerLoadout(optimizer())).toEqual(optimizer());
  });
  test("rejects wrong lengths and malformed tuning", () => {
    expect(parseOptimizerLoadout({ ...optimizer(), stats: [1, 2, 3] })).toBeNull();
    expect(parseOptimizerLoadout({ ...optimizer(), pieceIds: ["a"] })).toBeNull();
    expect(
      parseOptimizerLoadout({ ...optimizer(), tuning: [{ kind: "wat" }, null, null, null, null] }),
    ).toBeNull();
  });
});

describe("parseBuilderSnapshot", () => {
  test("round-trips with coerced setReqs keys", () => {
    const out = parseBuilderSnapshot(builder())!;
    expect(out.setReqs).toEqual({ 555: 2 });
    expect(out.exoticPerks).toEqual([null, 42]);
    expect(out.activeSubclass).toBe("Prismatic");
    expect(out.dreamersBond).toBe(true);
    expect(out.festivalMasks).toBe(true);
  });
  test("defaults dreamersBond to false when the field is missing", () => {
    const old = builder() as { dreamersBond?: boolean };
    delete old.dreamersBond;
    expect(parseBuilderSnapshot(old)?.dreamersBond).toBe(false);
  });
  test("defaults festivalMasks to false when the field is missing", () => {
    const old = builder() as { festivalMasks?: boolean };
    delete old.festivalMasks;
    expect(parseBuilderSnapshot(old)?.festivalMasks).toBe(false);
  });
  test("rejects an unknown subclass", () => {
    expect(parseBuilderSnapshot({ ...builder(), activeSubclass: "Kinetic" })).toBeNull();
  });
});

describe("parseSavedLoadoutData / parseSavedLoadout", () => {
  test("accepts loadout-only and full bodies", () => {
    const min = parseSavedLoadoutData({ version: LOADOUT_SCHEMA_VERSION, loadout: dim() })!;
    expect(min.optimizer).toBeUndefined();
    expect(min.builder).toBeUndefined();
    const full = parseSavedLoadoutData({
      version: LOADOUT_SCHEMA_VERSION,
      loadout: dim(),
      optimizer: optimizer(),
      builder: builder(),
    })!;
    expect(full.optimizer?.total).toBe(21);
    expect(full.builder?.major).toBe(2);
  });

  test("rejects a wrong version or a malformed optional section", () => {
    expect(parseSavedLoadoutData({ version: 2, loadout: dim() })).toBeNull();
    expect(
      parseSavedLoadoutData({ version: 1, loadout: dim(), optimizer: { nope: true } }),
    ).toBeNull();
  });

  test("full record needs id + timestamps", () => {
    const body = { version: 1, loadout: dim() };
    expect(parseSavedLoadout(body)).toBeNull();
    const rec = parseSavedLoadout({ ...body, id: "abc", createdAt: 1, updatedAt: 2 })!;
    expect(rec.id).toBe("abc");
    expect(rec.updatedAt).toBe(2);
  });
});

test("loadoutHashtags pulls tags from name + notes, lower-cased, deduped", () => {
  expect(loadoutHashtags({ name: "Raid #PvE build", notes: "#pve #Raid\n#dps-phase" })).toEqual([
    "pve",
    "raid",
    "dps-phase",
  ]);
  expect(loadoutHashtags({ name: "no tags", notes: "c#4 isn't one" })).toEqual([]);
});
