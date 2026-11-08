import { describe, expect, it } from "vitest";
import type { ArmorPiece } from "../armory/normalize";
import type { FarmPiece } from "../optimizer/dream";
import type { TheoryPiece } from "../optimizer/theory";
import {
  armorFarmKey,
  armorFarmTitle,
  armorFromDream,
  armorFromTheory,
  armorPlaceLabel,
  matchingArmor,
  newlyObtainedArmor,
} from "./armor";
import { isFarmDone, parseFarmEntry, parseFarmEntryData, parseFarmPatch, type ArmorFarmData, type ArmorFarmEntry } from "./types";

// Base stats that make stat 1 primary (30), stat 2 secondary (25) and stat 3 tertiary (20).
const BASE = [5, 30, 25, 20, 5, 5] as ArmorPiece["baseStats"];
const SET = 77;

function piece(over: Partial<ArmorPiece> = {}): ArmorPiece {
  return {
    instanceId: "6917529000000000001",
    itemHash: 1,
    name: "Bushido Mask",
    slot: "helmet",
    classType: 1,
    isExotic: false,
    isArtifice: false,
    isFestivalMask: false,
    archetype: "Gunner",
    baseStats: BASE,
    stats: BASE,
    tunedStat: 4,
    gearTier: 5,
    setHash: SET,
    location: "vault",
    ...over,
  } as ArmorPiece;
}

const theoryPiece = (over: Partial<TheoryPiece> = {}): TheoryPiece => ({
  archetype: "Gunner",
  primary: 1,
  secondary: 2,
  tertiary: 3,
  slot: 0,
  tuning: { plus: 4, minus: 0 },
  setHash: SET,
  ...over,
});

const data = (over: Partial<ArmorFarmData> = {}): ArmorFarmData => ({
  ...armorFromTheory(theoryPiece(), { classType: 1, setName: "Techsec" })!,
  ...over,
});

const entry = (id: string, createdAt: number, over: Partial<ArmorFarmEntry> = {}): ArmorFarmEntry => ({
  ...data(),
  id,
  createdAt,
  ...over,
});

describe("armorFromTheory", () => {
  it("records the slot, roll, tuned stat and set a card names", () => {
    expect(armorFromTheory(theoryPiece(), { classType: 1, setName: "Techsec" })).toMatchObject({
      slot: "helmet",
      rolls: [{ tertiary: 3, tuned: [4] }],
      setHash: SET,
      setName: "Techsec",
    });
  });

  it("takes any tuned stat on a row that needs none", () => {
    expect(armorFromTheory(theoryPiece({ tuning: null }), { classType: 1 })!.rolls[0].tuned).toBeNull();
  });

  it("makes no entry for a piece outside a required set", () => {
    expect(armorFromTheory(theoryPiece({ setHash: undefined }), { classType: 1 })).toBeNull();
  });

  it("makes no entry for an exotic", () => {
    expect(armorFromTheory(theoryPiece({ exotic: true }), { classType: 1 })).toBeNull();
  });
});

describe("armorFromDream", () => {
  const farm: FarmPiece = {
    slot: 3,
    archetype: "Gunner",
    primary: 1,
    secondary: 2,
    exotic: false,
    setHash: SET,
    rolls: [
      { tertiary: 3, tuned: null },
      { tertiary: 4, tuned: [0, 5] },
    ],
    fixed: false,
    complete: true,
  };

  it("keeps every roll the option accepts", () => {
    const made = armorFromDream(farm, { classType: 2 })!;
    expect(made.slot).toBe("legs");
    expect(made.setHash).toBe(SET);
    expect(made.rolls).toEqual(farm.rolls);
  });

  it("makes no entry for a piece outside a required set, or an exotic", () => {
    expect(armorFromDream({ ...farm, setHash: undefined }, { classType: 2 })).toBeNull();
    expect(armorFromDream({ ...farm, exotic: true }, { classType: 2 })).toBeNull();
  });
});

describe("the parser", () => {
  it("round-trips an armor entry", () => {
    const made = data();
    expect(parseFarmEntryData(JSON.parse(JSON.stringify(made)))).toEqual(made);
  });

  it.each([
    ["a bad class", { classType: 3 }],
    ["a bad slot", { slot: "boots" }],
    ["no slot", { slot: null }],
    ["no set", { setHash: undefined }],
    ["no rolls", { rolls: [] }],
    ["an out-of-range stat", { rolls: [{ tertiary: 6, tuned: null }] }],
    ["empty tuned stats", { rolls: [{ tertiary: 1, tuned: [] }] }],
  ])("rejects %s", (_, over) => {
    expect(parseFarmEntryData({ ...data(), ...over })).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(parseFarmEntryData({ ...data(), kind: "ghost" })).toBeNull();
  });
});

describe("Done", () => {
  it("parses a done patch", () => {
    expect(parseFarmPatch({ done: true })).toEqual({ done: true });
  });

  it("keeps doneAt through the parser and reads as finished", () => {
    const parsed = parseFarmEntry({
      ...data(),
      id: "a",
      createdAt: 1,
      obtained: { instanceId: "6917529000000000001", at: 2, seen: true, doneAt: 3 },
    })!;
    expect(parsed.obtained?.doneAt).toBe(3);
    expect(isFarmDone(parsed)).toBe(true);
  });

  it("isn't finished until then", () => {
    expect(isFarmDone({ obtained: { instanceId: "1", at: 2, seen: true } })).toBe(false);
    expect(isFarmDone({})).toBe(false);
  });
});

describe("matchingArmor", () => {
  it("matches the class, slot, archetype, set, tertiary and tuned stat", () => {
    expect(matchingArmor([piece()], data())).toHaveLength(1);
  });

  it.each([
    ["another class", { classType: 0 }],
    ["another slot", { slot: "arms" as const }],
    ["another archetype", { archetype: "Brawler" }],
    ["another set", { setHash: 9 }],
    ["no set", { setHash: undefined }],
    ["a lower tier", { gearTier: 4 }],
    ["another tuned stat", { tunedStat: 5 }],
    ["an exotic", { isExotic: true }],
    ["another tertiary", { baseStats: [20, 30, 25, 5, 5, 5] as ArmorPiece["baseStats"] }],
  ])("skips %s", (_, over) => {
    expect(matchingArmor([piece(over)], data())).toHaveLength(0);
  });

  it("honours any tuned stat", () => {
    expect(matchingArmor([piece({ tunedStat: 5 })], data({ rolls: [{ tertiary: 3, tuned: null }] }))).toHaveLength(1);
  });

  it("leaves out ignored copies", () => {
    expect(matchingArmor([piece()], data({ ignoredInstanceIds: [piece().instanceId] }))).toHaveLength(0);
  });
});

describe("newlyObtainedArmor", () => {
  it("gives one copy to the oldest entry that accepts it", () => {
    const older = entry("a", 1, { rolls: [{ tertiary: 3, tuned: null }] });
    const newer = entry("b", 2);
    expect(newlyObtainedArmor([piece()], [newer, older]).map((f) => f.entry.id)).toEqual(["a"]);
  });

  it("fills both entries when there are two copies", () => {
    const copies = [piece(), piece({ instanceId: "6917529000000000002" })];
    const older = entry("a", 1, { rolls: [{ tertiary: 3, tuned: null }] });
    expect(newlyObtainedArmor(copies, [older, entry("b", 2)])).toHaveLength(2);
  });

  it("won't reuse a copy another entry already obtained", () => {
    const done = entry("a", 1, { obtained: { instanceId: piece().instanceId, at: 5, seen: true } });
    expect(newlyObtainedArmor([piece()], [done, entry("b", 2)])).toHaveLength(0);
  });
});

describe("labels and keys", () => {
  it("names a piece by archetype and slot", () => {
    expect(armorFarmTitle(data())).toBe("Gunner Helmet");
  });

  it("says where a copy is", () => {
    expect(armorPlaceLabel(piece())).toBe("in your Vault");
    expect(armorPlaceLabel(piece({ location: "inventory" }))).toBe("on your Hunter");
    expect(armorPlaceLabel(piece({ location: "inventory", postmaster: true }))).toBe("at your Hunter's Postmaster");
  });

  it("keys ignore roll order but not what's asked for", () => {
    const a = data({ rolls: [{ tertiary: 3, tuned: [4, 0] }, { tertiary: 1, tuned: null }] });
    const b = data({ rolls: [{ tertiary: 1, tuned: null }, { tertiary: 3, tuned: [0, 4] }] });
    expect(armorFarmKey(a)).toBe(armorFarmKey(b));
    expect(armorFarmKey(data())).not.toBe(armorFarmKey(data({ setHash: 9 })));
  });
});
