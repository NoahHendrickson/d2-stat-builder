import { describe, expect, test } from "vitest";
import type { DestinyLoadoutComponent } from "bungie-api-ts/destiny2";
import {
  defaultIdentifiers,
  parseSnapshotRequest,
  toSlots,
  type InGameLoadoutIdentifiers,
} from "./ingame-loadouts";

const loadout = (ids: string[], hashes = 7): DestinyLoadoutComponent => ({
  nameHash: hashes,
  iconHash: hashes,
  colorHash: hashes,
  items: ids.map((itemInstanceId) => ({ itemInstanceId, plugItemHashes: [] })),
});

const identifiers: InGameLoadoutIdentifiers = {
  names: [
    { hash: 1, name: "Alpha" },
    { hash: 2, name: "Raid" },
  ],
  icons: [
    { hash: 10, path: "/a.png" },
    { hash: 11, path: "/b.png" },
  ],
  colors: [
    { hash: 20, path: "/a.jpg" },
    { hash: 21, path: "/b.jpg" },
  ],
};

describe("toSlots", () => {
  const hashOf = (id: string) => (id === "6917529" ? 42 : undefined);

  test("a slot is empty until some item has a real instance id", () => {
    const slots = toSlots([loadout(["0", "0"]), loadout(["0", "6917529"]), loadout([])], hashOf);
    expect(slots.map((s) => s.empty)).toEqual([true, false, true]);
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  test("items keep their order, with the hash of those still owned", () => {
    const [slot] = toSlots([loadout(["111", "0", "6917529"])], hashOf);
    expect(slot.items).toEqual([
      { itemInstanceId: "111" },
      { itemInstanceId: "6917529", itemHash: 42 },
    ]);
  });
});

describe("defaultIdentifiers", () => {
  test("a filled slot keeps its own identifiers", () => {
    const slot = { index: 0, nameHash: 2, iconHash: 11, colorHash: 21, items: [], empty: false };
    expect(defaultIdentifiers(slot, identifiers)).toEqual({ nameHash: 2, iconHash: 11, colorHash: 21 });
  });

  test("an empty slot, or a retired identifier, falls back to the first of each list", () => {
    const empty = { index: 0, nameHash: 2, iconHash: 11, colorHash: 21, items: [], empty: true };
    expect(defaultIdentifiers(empty, identifiers)).toEqual({ nameHash: 1, iconHash: 10, colorHash: 20 });
    const retired = { index: 0, nameHash: 99, iconHash: 11, colorHash: 21, items: [], empty: false };
    expect(defaultIdentifiers(retired, identifiers)).toEqual({ nameHash: 1, iconHash: 11, colorHash: 21 });
  });

  test("nothing to offer without the lists", () => {
    expect(defaultIdentifiers(undefined, { ...identifiers, names: [] })).toBeUndefined();
  });
});

describe("parseSnapshotRequest", () => {
  const body = { characterId: "2305843009", loadoutIndex: 3, nameHash: 1, iconHash: 10, colorHash: 4294967295 };

  test("accepts a well-formed request and drops unknown fields", () => {
    expect(parseSnapshotRequest({ ...body, extra: true })).toEqual(body);
  });

  test("rejects bad ids, slots, and hashes", () => {
    expect(parseSnapshotRequest(null)).toBeNull();
    expect(parseSnapshotRequest({ ...body, characterId: "12/../3" })).toBeNull();
    expect(parseSnapshotRequest({ ...body, characterId: 2305843009 })).toBeNull();
    expect(parseSnapshotRequest({ ...body, loadoutIndex: -1 })).toBeNull();
    expect(parseSnapshotRequest({ ...body, loadoutIndex: 1.5 })).toBeNull();
    expect(parseSnapshotRequest({ ...body, loadoutIndex: 400 })).toBeNull();
    expect(parseSnapshotRequest({ ...body, nameHash: undefined })).toBeNull();
    expect(parseSnapshotRequest({ ...body, colorHash: 4294967296 })).toBeNull();
  });
});
