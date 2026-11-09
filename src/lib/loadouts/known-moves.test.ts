import { describe, expect, test } from "vitest";
import type { Armory } from "../armory/fetch";
import { planSpares, planTransfers, type EquipItemState } from "../bungie/equip-plan";
import { spotsAfterApply, withKnownSpots } from "./known-moves";

const CHAR = "c1";
const piece = (instanceId: string, slot: string, location: string, characterId?: string) => ({
  instanceId,
  itemHash: 1,
  slot,
  location,
  characterId,
  isExotic: false,
});
/** What Bungie's profile says before the run: it never changes in these tests. */
const stale = {
  characters: [
    {
      id: CHAR,
      subclassItems: [
        { instanceId: "solar", itemHash: 1, equipped: true },
        { instanceId: "arc", itemHash: 2, equipped: false },
      ],
    },
  ],
  pieces: [
    piece("old-helm", "helmet", "equipped", CHAR),
    piece("helm-a", "helmet", "vault"),
    piece("boots", "legs", "vault"),
    piece("spare", "legs", "inventory", CHAR),
  ],
  weapons: [],
} as unknown as Armory;

const ok = (itemInstanceId: string, vaulted?: string[]) => ({ itemInstanceId, ok: true, vaulted });
const stateOf = (armory: Armory, id: string): EquipItemState => {
  const p = armory.pieces.find((x) => x.instanceId === id)!;
  return { itemInstanceId: id, itemHash: p.itemHash, location: p.location, characterId: p.characterId };
};

describe("a loadout planned after another one in the same run", () => {
  test("the old profile would move a piece from a vault it already left", () => {
    expect(planTransfers([stateOf(stale, "boots")], CHAR)).toEqual([
      { itemId: "boots", itemReferenceHash: 1, transferToVault: false, characterId: CHAR },
    ]);
  });

  test("a piece the last loadout equipped needs no move, even if the profile lags", () => {
    const known = spotsAfterApply(new Map(), stale, [ok("helm-a"), ok("boots")], CHAR);
    const armory = withKnownSpots(stale, known);
    expect(planTransfers([stateOf(armory, "boots")], CHAR)).toEqual([]);
  });

  test("what a piece replaced is shown in the inventory", () => {
    const known = spotsAfterApply(new Map(), stale, [ok("helm-a")], CHAR);
    expect(known.get("old-helm")).toEqual({ location: "inventory", characterId: CHAR });
  });

  test("a spare vaulted to make room is back in the vault, and moved for again", () => {
    const known = spotsAfterApply(new Map(), stale, [ok("boots", ["spare"])], CHAR);
    const armory = withKnownSpots(stale, known);
    expect(planTransfers([stateOf(armory, "spare")], CHAR)).toEqual([
      { itemId: "spare", itemReferenceHash: 1, transferToVault: false, characterId: CHAR },
    ]);
  });

  test("a vaulted spare is no longer offered to make room again", () => {
    const known = spotsAfterApply(new Map(), stale, [ok("boots", ["spare"])], CHAR);
    const armory = withKnownSpots(stale, known);
    const next = { itemInstanceId: "x", itemHash: 1, location: "vault" as const };
    const pieces = [...armory.pieces, piece("x", "legs", "vault")] as never[];
    expect(planSpares(pieces, [next], CHAR)).toEqual({});
  });

  test("a failed piece stays where the profile says, but its vaulted spare doesn't", () => {
    const known = spotsAfterApply(
      new Map(),
      stale,
      [{ itemInstanceId: "boots", ok: false, vaulted: ["spare"] }],
      CHAR,
    );
    expect(known.has("boots")).toBe(false);
    expect(known.get("spare")).toEqual({ location: "vault" });
  });

  test("a piece that reached the character but didn't equip is in its inventory", () => {
    const known = spotsAfterApply(
      new Map(),
      stale,
      [{ itemInstanceId: "boots", ok: false, staged: true }],
      CHAR,
    );
    const armory = withKnownSpots(stale, known);
    expect(known.get("boots")).toEqual({ location: "inventory", characterId: CHAR });
    expect(planTransfers([stateOf(armory, "boots")], CHAR)).toEqual([]);
  });

  test("moves add up across a run", () => {
    const first = spotsAfterApply(new Map(), stale, [ok("helm-a")], CHAR);
    const second = spotsAfterApply(first, withKnownSpots(stale, first), [ok("old-helm")], CHAR);
    expect(second.get("helm-a")).toEqual({ location: "inventory", characterId: CHAR });
    expect(second.get("old-helm")).toEqual({ location: "equipped", characterId: CHAR });
  });

  test("the subclass last equipped is the one that reads as equipped", () => {
    const known = spotsAfterApply(new Map(), stale, [ok("arc")], CHAR);
    const { subclassItems } = withKnownSpots(stale, known).characters[0];
    expect(subclassItems.map((s) => [s.instanceId, s.equipped])).toEqual([
      ["solar", false],
      ["arc", true],
    ]);
  });
});
