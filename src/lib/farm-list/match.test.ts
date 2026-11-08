import { describe, expect, it } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { pickSlots } from "../weapons/pick-slots";
import type { PerkRef, WeaponSummary } from "../weapons/types";
import { canFarm, matchingCopies, newlyObtained, sameFarmWeapon, farmWeaponFromPicks, dismantledDrops } from "./match";
import { parseFarmEntry, parseFarmEntryData, type WeaponFarmData, type WeaponFarmEntry } from "./types";

// 0 frame, 1–2 barrels, 3–4 left traits, 5–6 right traits, 7 masterwork, 8 mod.
const PERKS: PerkRef[] = [
  { hash: 100, name: "Adaptive Frame", currentlyCanRoll: true },
  { hash: 201, name: "Arrowhead Brake", currentlyCanRoll: true },
  { hash: 202, name: "Smallbore", currentlyCanRoll: true },
  { hash: 301, name: "Outlaw", currentlyCanRoll: true, alternateHashes: [3011] },
  { hash: 302, name: "Rapid Hit", currentlyCanRoll: true },
  { hash: 401, name: "Kill Clip", currentlyCanRoll: true },
  { hash: 402, name: "Rampage", currentlyCanRoll: true },
  { hash: 501, name: "Range Masterwork", currentlyCanRoll: true },
  { hash: 601, name: "Backup Mag", currentlyCanRoll: true },
];

const weapon = (overrides: Partial<WeaponSummary> = {}): WeaponSummary =>
  ({
    hash: 1,
    name: "Fatebringer",
    craftable: false,
    columns: [
      { kind: "Intrinsic", perkIndices: [0] },
      { kind: "Barrel", perkIndices: [1, 2] },
      { kind: "Trait", perkIndices: [3, 4] },
      { kind: "Trait", perkIndices: [5, 6] },
    ],
    masterworks: [7],
    mods: [8],
    ...overrides,
  }) as WeaponSummary;

const ADEPT = weapon({ hash: 2, name: "Fatebringer (Adept)" });
const OTHER = weapon({ hash: 3, name: "Fatebringer", columns: [{ kind: "Trait", perkIndices: [4] }] });

function makeEntry(picks: Record<number, number>, w = weapon()): WeaponFarmData | null {
  return farmWeaponFromPicks(w, PERKS, [w, ADEPT, OTHER], pickSlots(w), picks);
}

/** A profile with copies in the vault: hash, instance id, socket plugs, state. */
function profile(
  copies: { hash: number; id: string; sockets: number[][]; state?: number }[],
): DestinyProfileResponse {
  return {
    profileInventory: {
      data: {
        items: copies.map((c) => ({
          itemHash: c.hash,
          itemInstanceId: c.id,
          state: c.state ?? 0,
          bucketHash: 138197802,
        })),
      },
    },
    itemComponents: {
      sockets: {
        data: Object.fromEntries(
          copies.map((c) => [c.id, { sockets: c.sockets.map((plugs) => ({ plugHash: plugs[0] })) }]),
        ),
      },
      reusablePlugs: {
        data: Object.fromEntries(
          copies.map((c) => [
            c.id,
            { plugs: Object.fromEntries(c.sockets.map((plugs, i) => [i, plugs.map((h) => ({ plugItemHash: h }))])) },
          ]),
        ),
      },
    },
  } as unknown as DestinyProfileResponse;
}

describe("canFarm", () => {
  it("needs two trait columns, one of them a choice, on a weapon that isn't craftable", () => {
    expect(canFarm(weapon())).toBe(true);
    expect(canFarm(weapon({ craftable: true }))).toBe(false);
    expect(canFarm(OTHER)).toBe(false);
    expect(
      canFarm(weapon({ columns: [{ kind: "Trait", perkIndices: [3] }, { kind: "Trait", perkIndices: [5] }] })),
    ).toBe(false);
  });
});

describe("farmWeaponFromPicks", () => {
  it("waits for both traits", () => {
    expect(makeEntry({ 2: 3 })).toBeNull();
  });

  it("keeps the traits with their enhanced hashes, other picks as extras, and no mods", () => {
    const entry = makeEntry({ 1: 2, 2: 3, 3: 6, 4: 7, 5: 8 })!;
    expect(entry.traits.map((t) => t.hashes)).toEqual([[301, 3011], [402]]);
    expect(entry.extras.map((e) => [e.kind, e.slot, e.name])).toEqual([
      ["Barrel", "barrel", "Smallbore"],
      ["Masterwork", "masterwork", "Range Masterwork"],
    ]);
  });

  it("matches same-name versions that roll both traits, adept included", () => {
    expect(makeEntry({ 2: 3, 3: 6 })!.weaponHashes).toEqual([1, 2]);
  });

  it("fills a trait column with only one perk", () => {
    const w = weapon({
      columns: [
        { kind: "Trait", perkIndices: [3, 4] },
        { kind: "Trait", perkIndices: [6] },
      ],
    });
    expect(makeEntry({ 0: 4 }, w)!.traits.map((t) => t.name)).toEqual(["Rapid Hit", "Rampage"]);
  });

  it("survives the API's parser", () => {
    const entry = makeEntry({ 1: 2, 2: 3, 3: 6 })!;
    expect(parseFarmEntryData(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });
});

describe("matchingCopies", () => {
  const entry = makeEntry({ 2: 3, 3: 6 })!;

  it("finds a copy with both traits, enhanced or not, in any order of rolled options", () => {
    const p = profile([
      { hash: 1, id: "10", sockets: [[100], [201], [302, 3011], [401, 402]] },
      { hash: 1, id: "11", sockets: [[100], [201], [302], [401, 402]] },
      { hash: 2, id: "12", sockets: [[100], [301], [402]] },
      { hash: 9, id: "13", sockets: [[301], [402]] },
    ]);
    expect(matchingCopies(p, entry).map((c) => c.instanceId)).toEqual(["10", "12"]);
  });

  it("needs the two traits in two sockets", () => {
    const p = profile([{ hash: 1, id: "10", sockets: [[301, 402]] }]);
    expect(matchingCopies(p, entry)).toEqual([]);
  });

  it("skips crafted and ignored copies", () => {
    const p = profile([
      { hash: 1, id: "10", sockets: [[301], [402]], state: 8 },
      { hash: 1, id: "11", sockets: [[301], [402]] },
    ]);
    expect(matchingCopies(p, { ...entry, ignoredInstanceIds: ["11"] })).toEqual([]);
  });
});

describe("picked extras are strict", () => {
  // Pick keys: 1 is the barrel, 4 the masterwork.
  const entry = makeEntry({ 1: 2, 2: 3, 3: 6 })!;
  const barrel = entry.extras[0]!.hashes[0]!;

  it("needs a picked barrel on the copy", () => {
    const p = profile([{ hash: 1, id: "10", sockets: [[barrel + 999], [301], [402]] }]);
    expect(matchingCopies(p, entry)).toEqual([]);
  });

  it("matches a copy that has it", () => {
    const p = profile([{ hash: 1, id: "10", sockets: [[barrel], [301], [402]] }]);
    expect(matchingCopies(p, entry).map((c) => c.instanceId)).toEqual(["10"]);
  });

  it("doesn't need the masterwork", () => {
    const mw = makeEntry({ 2: 3, 3: 6, 4: 7 })!;
    expect(mw.extras.map((e) => e.slot)).toEqual(["masterwork"]);
    const p = profile([{ hash: 1, id: "10", sockets: [[301], [402]] }]);
    expect(matchingCopies(p, mw).map((c) => c.instanceId)).toEqual(["10"]);
  });

  it("doesn't need anything left unpicked", () => {
    const p = profile([{ hash: 1, id: "10", sockets: [[barrel + 999], [301], [402]] }]);
    expect(matchingCopies(p, makeEntry({ 2: 3, 3: 6 })!)).toHaveLength(1);
  });
});

describe("newlyObtained", () => {
  it("reports waiting entries only", () => {
    const data = makeEntry({ 2: 3, 3: 6 })!;
    const waiting = parseFarmEntry({ ...data, id: "a", createdAt: 1 }) as WeaponFarmEntry;
    const done = { ...waiting, id: "b", obtained: { instanceId: "11", at: 2, seen: false } };
    const p = profile([{ hash: 1, id: "10", sockets: [[301], [402]] }]);
    expect(newlyObtained(p, [waiting, done]).map((m) => [m.entry.id, m.copy.instanceId])).toEqual([["a", "10"]]);
  });

  // X+Y, and X+Y with a picked barrel: different hunts that one copy can satisfy.
  const loose = parseFarmEntry({ ...makeEntry({ 2: 3, 3: 6 })!, id: "loose", createdAt: 2 }) as WeaponFarmEntry;
  const strict = parseFarmEntry({ ...makeEntry({ 1: 1, 2: 3, 3: 6 })!, id: "strict", createdAt: 1 }) as WeaponFarmEntry;
  const copy = (id: string) => ({ hash: 1, id, sockets: [[201], [301], [402]] });

  it("gives one copy to the oldest entry that accepts it", () => {
    const found = newlyObtained(profile([copy("10")]), [loose, strict]);
    expect(found.map((m) => [m.entry.id, m.copy.instanceId])).toEqual([["strict", "10"]]);
  });

  it("fills both entries when there are two copies", () => {
    const found = newlyObtained(profile([copy("10"), copy("11")]), [loose, strict]);
    expect(found.map((m) => [m.entry.id, m.copy.instanceId])).toEqual([
      ["strict", "10"],
      ["loose", "11"],
    ]);
  });

  it("won't reuse a copy another entry already holds", () => {
    const held = { ...strict, obtained: { instanceId: "10", at: 5, seen: true } };
    expect(newlyObtained(profile([copy("10")]), [held, loose])).toEqual([]);
  });
});

describe("dismantledDrops", () => {
  const data = makeEntry({ 2: 3, 3: 6 })!;
  const whole = (minted: string) =>
    ({
      ...profile([{ hash: 1, id: "10", sockets: [[301], [402]] }]),
      responseMintedTimestamp: minted,
      characterInventories: { data: {} },
      characterEquipment: { data: {} },
    }) as unknown as DestinyProfileResponse;
  const entry = (id: string, obtained?: WeaponFarmEntry["obtained"]) =>
    ({ ...data, id, createdAt: 1, ...(obtained ? { obtained } : {}) }) as WeaponFarmEntry;
  const AFTER = "2026-11-08T12:00:00Z";
  const dropAt = Date.parse("2026-11-08T11:00:00Z");
  const ids = (list: WeaponFarmEntry[]) => list.map((e) => e.id);

  it("finds a new drop whose copy is gone", () => {
    expect(ids(dismantledDrops(whole(AFTER), [entry("a", { instanceId: "99", at: dropAt, seen: true })]))).toEqual(["a"]);
  });

  it("counts it even if it was seen, as long as it wasn't kept", () => {
    expect(dismantledDrops(whole(AFTER), [entry("a", { instanceId: "99", at: dropAt, seen: false })])).toHaveLength(1);
  });

  it("leaves a copy that's still held", () => {
    expect(dismantledDrops(whole(AFTER), [entry("a", { instanceId: "10", at: dropAt, seen: true })])).toEqual([]);
  });

  it("leaves a kept record and a waiting entry", () => {
    const list = [entry("a", { instanceId: "99", at: dropAt, seen: true, doneAt: dropAt + 1 }), entry("b")];
    expect(dismantledDrops(whole(AFTER), list)).toEqual([]);
  });

  it("doesn't trust a profile from before the drop", () => {
    expect(dismantledDrops(whole("2026-11-08T10:00:00Z"), [entry("a", { instanceId: "99", at: dropAt, seen: true })])).toEqual([]);
  });

  it.each(["profileInventory", "characterInventories", "characterEquipment"])("doesn't trust a profile without %s", (part) => {
    const partial = { ...whole(AFTER), [part]: {} } as unknown as DestinyProfileResponse;
    expect(dismantledDrops(partial, [entry("a", { instanceId: "99", at: dropAt, seen: true })])).toEqual([]);
  });

  it("doesn't trust an empty inventory", () => {
    const empty = { ...whole(AFTER), profileInventory: { data: { items: [] } } } as unknown as DestinyProfileResponse;
    expect(dismantledDrops(empty, [entry("a", { instanceId: "99", at: dropAt, seen: true })])).toEqual([]);
  });
});

describe("sameFarmWeapon", () => {
  it("ignores trait order and matches across versions", () => {
    const a = makeEntry({ 2: 3, 3: 6 })!;
    const b = { ...a, weaponHashes: [2], traits: [a.traits[1], a.traits[0]] as WeaponFarmData["traits"] };
    expect(sameFarmWeapon(a, b)).toBe(true);
    expect(sameFarmWeapon(a, makeEntry({ 2: 4, 3: 6 })!)).toBe(false);
  });

  it("treats a different barrel as a different roll, but not a different masterwork", () => {
    const a = makeEntry({ 2: 3, 3: 6 })!;
    expect(sameFarmWeapon(a, makeEntry({ 1: 2, 2: 3, 3: 6 })!)).toBe(false);
    expect(sameFarmWeapon(a, makeEntry({ 2: 3, 3: 6, 4: 7 })!)).toBe(true);
  });
});
