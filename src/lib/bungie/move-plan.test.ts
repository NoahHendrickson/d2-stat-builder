import { expect, test } from "vitest";
import { MovePlanError, planMove, type MoveRequest } from "./move-plan";

const req = (from: MoveRequest["from"], to: MoveRequest["to"], itemId = "i1"): MoveRequest => ({
  itemId,
  itemHash: 7,
  stackSize: 1,
  from,
  to,
});
const A = "char-A";
const B = "char-B";

test("vault ↔ character is one transfer", () => {
  expect(planMove(req({ kind: "vault" }, { kind: "character", characterId: A }))).toEqual([
    { kind: "fromVault", characterId: A },
  ]);
  expect(planMove(req({ kind: "character", characterId: A }, { kind: "vault" }))).toEqual([
    { kind: "toVault", characterId: A },
  ]);
});

test("character to character hops through the vault, then equips if asked", () => {
  expect(
    planMove(req({ kind: "character", characterId: A }, { kind: "character", characterId: B, equip: true })),
  ).toEqual([
    { kind: "toVault", characterId: A },
    { kind: "fromVault", characterId: B },
    { kind: "equip", characterId: B },
  ]);
});

test("equipping from the same character's inventory is just an equip", () => {
  expect(
    planMove(req({ kind: "character", characterId: A }, { kind: "character", characterId: A, equip: true })),
  ).toEqual([{ kind: "equip", characterId: A }]);
  expect(planMove(req({ kind: "character", characterId: A }, { kind: "character", characterId: A }))).toEqual([]);
});

test("postmaster items are pulled onto their owner first", () => {
  expect(planMove(req({ kind: "postmaster", characterId: A }, { kind: "character", characterId: A }))).toEqual([
    { kind: "pull", characterId: A },
  ]);
  expect(planMove(req({ kind: "postmaster", characterId: A }, { kind: "character", characterId: B }))).toEqual([
    { kind: "pull", characterId: A },
    { kind: "toVault", characterId: A },
    { kind: "fromVault", characterId: B },
  ]);
  expect(planMove(req({ kind: "postmaster", characterId: A }, { kind: "vault" }))).toEqual([
    { kind: "pull", characterId: A },
    { kind: "toVault", characterId: A },
  ]);
});

test("stacks only come out of the postmaster onto their own character", () => {
  expect(() =>
    planMove(req({ kind: "postmaster", characterId: A }, { kind: "vault" }, "0")),
  ).toThrow(MovePlanError);
});

test("equipped items are refused unless it's a no-op", () => {
  expect(() =>
    planMove(req({ kind: "character", characterId: A, equipped: true }, { kind: "vault" })),
  ).toThrow(MovePlanError);
  expect(
    planMove(
      req({ kind: "character", characterId: A, equipped: true }, { kind: "character", characterId: A, equip: true }),
    ),
  ).toEqual([]);
});
