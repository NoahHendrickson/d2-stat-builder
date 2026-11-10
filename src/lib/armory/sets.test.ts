import { describe, expect, it } from "vitest";
import { classSets, makeableSetReqs, toggleSetReq } from "./sets";
import type { ArmorPiece } from "./normalize";
import type { Manifest } from "../manifest/load";

const HELMET_BUCKET = 3448274439;
const WEAPON_BUCKET = 1498876634;

/** A manifest holding just set definitions, their items, and their perks. */
function manifestWith(tables: Record<string, Record<number, unknown>>): Manifest {
  return {
    all: (table: string) => tables[table] ?? {},
    def: (table: string, hash: number) => tables[table]?.[hash],
  } as unknown as Manifest;
}

const perks = [{ requiredSetCount: 2, sandboxPerkHash: 900 }];

describe("classSets", () => {
  it("lists every set the class can wear, owned or not, with owned counts", () => {
    const manifest = manifestWith({
      DestinyEquipableItemSetDefinition: {
        1: { displayProperties: { name: "Owned Set" }, setPerks: perks, setItems: [11] },
        2: { displayProperties: { name: "Unowned Set" }, setPerks: perks, setItems: [12] },
        3: { displayProperties: { name: "Titan Only" }, setPerks: perks, setItems: [13] },
        4: { displayProperties: { name: "No Perks" }, setPerks: [], setItems: [11] },
        5: { displayProperties: { name: "Weapon Set" }, setPerks: perks, setItems: [14] },
      },
      DestinyInventoryItemDefinition: {
        11: { classType: 1, inventory: { bucketTypeHash: HELMET_BUCKET } },
        12: { classType: 1, inventory: { bucketTypeHash: HELMET_BUCKET } },
        13: { classType: 0, inventory: { bucketTypeHash: HELMET_BUCKET } },
        14: { classType: 1, inventory: { bucketTypeHash: WEAPON_BUCKET } },
      },
      DestinySandboxPerkDefinition: { 900: { displayProperties: { name: "Bonus" } } },
    });
    const owned = [{ setHash: 1 }, { setHash: 1 }] as ArmorPiece[];
    const sets = classSets(manifest, 1, owned);
    expect(sets.map((s) => [s.name, s.ownedCount])).toEqual([
      ["Owned Set", 2],
      ["Unowned Set", 0],
    ]);
    expect(sets[1].perks).toEqual([{ requiredCount: 2, name: "Bonus", description: undefined }]);
  });
});

describe("makeableSetReqs", () => {
  const owned = (n: number) => ({ ownedCount: n });
  it("keeps what the owned pieces make, drops a 4pc to the 2pc, and drops the rest", () => {
    const sets = new Map([
      [1, owned(4)],
      [2, owned(3)],
      [3, owned(1)],
    ]);
    expect(makeableSetReqs({ 1: 4, 2: 4, 3: 2, 4: 2 }, sets)).toEqual({ 1: 4, 2: 2 });
  });

  it("returns the same object when every requirement can be made", () => {
    const reqs = { 1: 2 as const };
    expect(makeableSetReqs(reqs, new Map([[1, owned(2)]]))).toBe(reqs);
  });
});

describe("toggleSetReq", () => {
  const all = () => true;

  it("picking a 4-piece bonus drops another set's shown 4-piece bonus", () => {
    const reqs = { 1: 4, 2: 2 } as const;
    expect(toggleSetReq(reqs, reqs, 3, 4, all, 8)).toEqual({ 2: 2, 3: 4 });
  });

  it("leaves 2-piece bonuses alone, and a stored 4-piece the list shows as a 2-piece", () => {
    // Set 1 is stored as 4 but only makes its 2-piece, so it isn't a second 4-piece.
    expect(toggleSetReq({ 1: 4, 2: 2 }, { 1: 2, 2: 2 }, 3, 4, all, 8)).toEqual({ 1: 4, 2: 2, 3: 4 });
    expect(toggleSetReq({ 1: 4 }, { 1: 4 }, 2, 2, all, 8)).toEqual({ 1: 4, 2: 2 });
  });

  it("clicking the shown bonus takes it off, and past the cap a hidden set goes first", () => {
    expect(toggleSetReq({ 1: 4, 2: 2 }, { 1: 4, 2: 2 }, 1, 4, all, 8)).toEqual({ 2: 2 });
    expect(toggleSetReq({ 1: 2, 2: 2 }, { 1: 2 }, 3, 2, (h) => h !== 2, 2)).toEqual({ 1: 2, 3: 2 });
  });
});
