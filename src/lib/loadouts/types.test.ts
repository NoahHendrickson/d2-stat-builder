import { test, expect, describe } from "vitest";
import {
  LOADOUT_SCHEMA_VERSION,
  MAX_NOTES_LENGTH,
  MAX_TAG_LENGTH,
  loadoutHashtags,
  loadoutNotesHashtags,
  normalizeTag,
  newerSavedLoadout,
  parseBuilderSnapshot,
  parseDimLoadout,
  parseOptimizerLoadout,
  parseSavedLoadout,
  parseSavedLoadoutData,
  withLoadoutTag,
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
  lowerTierArmor: true,
  powerRange: {
    enabled: true,
    bounds: { min: 287, max: 292 },
    weapons: [290, null, 295],
    dreamersBond: true,
    legacyArmor: false,
  },
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
    // `power` was added later: absent reads as unknown (null), so older rows still parse.
    expect(parseOptimizerLoadout(optimizer())).toEqual({ ...optimizer(), power: null });
    expect(parseOptimizerLoadout({ ...optimizer(), power: 291 })?.power).toBe(291);
    expect(parseOptimizerLoadout({ ...optimizer(), power: "291" })?.power).toBeNull();
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
    expect(out.powerRange.dreamersBond).toBe(true);
  });
  test("drops the retired top-level dreamersBond / festivalMasks pins from older snapshots", () => {
    const old = { ...builder(), dreamersBond: true, festivalMasks: true };
    const out = parseBuilderSnapshot(old)!;
    expect(out).not.toHaveProperty("dreamersBond");
    expect(out).not.toHaveProperty("festivalMasks");
  });
  test("round-trips the power range and defaults it off when missing or malformed", () => {
    const off = { enabled: false, bounds: null, weapons: [null, null, null], dreamersBond: false, legacyArmor: false };
    expect(parseBuilderSnapshot(builder())?.powerRange).toEqual({
      enabled: true,
      bounds: { min: 287, max: 292 },
      weapons: [290, null, 295],
      dreamersBond: true,
      legacyArmor: false,
    });
    const old = builder() as { powerRange?: unknown };
    delete old.powerRange;
    expect(parseBuilderSnapshot(old)?.powerRange).toEqual(off);
    expect(
      parseBuilderSnapshot({
        ...builder(),
        powerRange: { enabled: true, bounds: { min: 300, max: 290 } },
      })?.powerRange,
    ).toEqual({
      enabled: true,
      bounds: { min: 290, max: 300 },
      weapons: [null, null, null],
      dreamersBond: false,
      legacyArmor: false,
    });
    expect(
      parseBuilderSnapshot({
        ...builder(),
        powerRange: { enabled: true, bounds: { min: "a", max: 290 } },
      })?.powerRange,
    ).toEqual(off);
    // Enabled with bounds never set is legal (constrains nothing).
    expect(
      parseBuilderSnapshot({ ...builder(), powerRange: { enabled: true, bounds: null } })
        ?.powerRange,
    ).toEqual({ enabled: true, bounds: null, weapons: [null, null, null], dreamersBond: false, legacyArmor: false });
    // Malformed weapons drop to "nothing entered" without losing the range itself.
    expect(
      parseBuilderSnapshot({
        ...builder(),
        powerRange: { enabled: true, bounds: { min: 287, max: 292 }, weapons: [290, "x"] },
      })?.powerRange,
    ).toEqual({
      enabled: true,
      bounds: { min: 287, max: 292 },
      weapons: [null, null, null],
      dreamersBond: false,
      legacyArmor: false,
    });
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

test("newerSavedLoadout keeps a later updatedAt so a stale PUT cannot roll back", () => {
  const body = { version: 1, loadout: dim() };
  const older = parseSavedLoadout({ ...body, id: "abc", createdAt: 1, updatedAt: 1 })!;
  const newer = parseSavedLoadout({
    ...body,
    id: "abc",
    createdAt: 1,
    updatedAt: 2,
    loadout: { ...dim(), name: "After" },
  })!;
  expect(
    newerSavedLoadout(newer, { ...older, loadout: { ...older.loadout, name: "Before" } })
      .loadout.name,
  ).toBe("After");
  expect(newerSavedLoadout(older, newer).loadout.name).toBe("After");
  expect(newerSavedLoadout(newer, { ...newer, loadout: { ...newer.loadout, name: "Same ts" } }).loadout.name).toBe("Same ts");
});

test("loadoutHashtags pulls tags from name + notes, lower-cased, deduped", () => {
  expect(loadoutHashtags({ name: "Raid #PvE build", notes: "#pve #Raid\n#dps-phase" })).toEqual([
    "pve",
    "raid",
    "dps-phase",
  ]);
  expect(loadoutHashtags({ name: "no tags", notes: "c#4 isn't one" })).toEqual([]);
});

test("normalizeTag strips #, lower-cases, and rejects junk", () => {
  expect(normalizeTag(" #PvE ")).toBe("pve");
  expect(normalizeTag("dps-phase")).toBe("dps-phase");
  expect(normalizeTag("")).toBeNull();
  expect(normalizeTag("#")).toBeNull();
  expect(normalizeTag("has space")).toBeNull();
  expect(normalizeTag("!!!")).toBeNull();
});

test("withLoadoutTag writes hashtags into notes and strips them back out", () => {
  const base = parseDimLoadout(dim())!;
  const tagged = withLoadoutTag({ ...base, notes: undefined }, "PvE", true);
  expect(tagged.notes).toBe("#pve");
  expect(withLoadoutTag(tagged, "raid", true).notes).toBe("#pve #raid");
  expect(withLoadoutTag(tagged, "pve", true)).toBe(tagged);

  const both = withLoadoutTag(withLoadoutTag({ ...base, notes: "keep me" }, "pve", true), "raid", true);
  expect(both.notes).toBe("keep me #pve #raid");
  expect(withLoadoutTag(both, "pve", false).notes).toBe("keep me #raid");
  expect(withLoadoutTag(withLoadoutTag(both, "pve", false), "raid", false).notes).toBe("keep me");

  const onlyTags = withLoadoutTag(withLoadoutTag({ ...base, notes: undefined }, "pve", true), "pve", false);
  expect(onlyTags.notes).toBeUndefined();
  expect(onlyTags).not.toHaveProperty("notes");
});

test("withLoadoutTag no-ops when notes would overflow", () => {
  const base = parseDimLoadout(dim())!;
  const full = { ...base, notes: "x".repeat(MAX_NOTES_LENGTH) };
  expect(withLoadoutTag(full, "pve", true)).toBe(full);
});

test("withLoadoutTag strips a tag even when punctuation follows it", () => {
  const base = parseDimLoadout(dim())!;
  const noted = { ...base, notes: "Use for #raid, or #pve." };
  expect(loadoutHashtags(noted)).toEqual(["raid", "pve"]);
  expect(withLoadoutTag(noted, "raid", false).notes).toBe("Use for , or #pve.");
  expect(withLoadoutTag(noted, "pve", false).notes).toBe("Use for #raid, or .");
});

test("withLoadoutTag unchecks a tag that only lives in the name", () => {
  const base = parseDimLoadout(dim())!;
  const named = { ...base, name: "Raid #pve set", notes: undefined };
  expect(loadoutHashtags(named)).toEqual(["pve"]);
  expect(loadoutNotesHashtags(named.notes)).toEqual([]);
  // The badges, the filter and the cap all read name + notes, so the menu's
  // checkbox has to be able to clear either one.
  expect(withLoadoutTag(named, "pve", false).name).toBe("Raid set");
  // …except when the name is nothing but the tag: every loadout needs a name.
  const only = { ...base, name: "#pve", notes: undefined };
  expect(withLoadoutTag(only, "pve", false)).toBe(only);
});

test("removing a tag leaves the rest of the note exactly as typed", () => {
  const base = parseDimLoadout(dim())!;
  const prose = { ...base, notes: "Boss DPS\n\n\nSwap  to  Still Hunt  #pve" };
  expect(withLoadoutTag(prose, "pve", false).notes).toBe(
    "Boss DPS\n\n\nSwap  to  Still Hunt",
  );

  const markdown = { ...base, notes: "Notes:\n  - step one\n  - step two\n\n#pve" };
  expect(withLoadoutTag(markdown, "pve", false).notes).toBe(
    "Notes:\n  - step one\n  - step two",
  );

  // A tag on its own line takes the line, not the paragraph around it.
  const ownLine = { ...base, notes: "before\n#pve\nafter" };
  expect(withLoadoutTag(ownLine, "pve", false).notes).toBe("before\nafter");

  // Adding then removing is a round trip.
  const typed = { ...base, notes: "Rotation:\n\n1. Do X   then Y" };
  expect(
    withLoadoutTag(withLoadoutTag(typed, "pve", true), "pve", false).notes,
  ).toBe(typed.notes);
});

test("a tag longer than the add limit can still be read and removed", () => {
  const base = parseDimLoadout(dim())!;
  const long = "day-one-vault-of-glass-flawless-challenge-run";
  expect(long.length).toBeGreaterThan(MAX_TAG_LENGTH);
  const noted = { ...base, notes: `Run notes #${long}` };
  // Visible to the badges and the tag filter…
  expect(loadoutHashtags(noted)).toEqual([long]);
  // …not offered as something new to create…
  expect(normalizeTag(long)).toBeNull();
  // …but the checkbox can still take it off.
  expect(withLoadoutTag(noted, long, false).notes).toBe("Run notes");
});
