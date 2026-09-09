import { test, expect, describe } from "vitest";
import { planEquipBatches, planSpares, planTransfers, type EquipItemState } from "./equip-plan";

const TARGET = "char-A";

function item(over: Partial<EquipItemState>): EquipItemState {
  return { itemInstanceId: "i1", itemHash: 111, location: "vault", ...over };
}

test("piece already on the target character needs no transfer", () => {
  expect(
    planTransfers(
      [
        item({ location: "inventory", characterId: TARGET }),
        item({ location: "equipped", characterId: TARGET }),
      ],
      TARGET,
    ),
  ).toEqual([]);
});

test("vault piece takes one hop to the target", () => {
  expect(planTransfers([item({ itemInstanceId: "v1", itemHash: 42 })], TARGET)).toEqual([
    { itemId: "v1", itemReferenceHash: 42, transferToVault: false, characterId: TARGET },
  ]);
});

test("piece on another character takes two hops through the vault", () => {
  expect(
    planTransfers(
      [item({ itemInstanceId: "o1", itemHash: 7, location: "inventory", characterId: "char-B" })],
      TARGET,
    ),
  ).toEqual([
    { itemId: "o1", itemReferenceHash: 7, transferToVault: true, characterId: "char-B" },
    { itemId: "o1", itemReferenceHash: 7, transferToVault: false, characterId: TARGET },
  ]);
});

test("mixed set plans each piece independently, in order", () => {
  const actions = planTransfers(
    [
      item({ itemInstanceId: "a", characterId: undefined }), // vault
      item({ itemInstanceId: "b", location: "equipped", characterId: TARGET }), // no-op
      item({ itemInstanceId: "c", location: "inventory", characterId: "char-B" }), // 2 hops
    ],
    TARGET,
  );
  expect(actions.map((a) => [a.itemId, a.transferToVault])).toEqual([
    ["a", false],
    ["c", true],
    ["c", false],
  ]);
});

test("equip batches put legendaries first so a different-slot exotic can come off", () => {
  const items: EquipItemState[] = [
    item({ itemInstanceId: "helm", isExotic: true }),
    item({ itemInstanceId: "chest" }),
    item({ itemInstanceId: "subclass" }),
  ];
  expect(planEquipBatches(["helm", "chest", "subclass"], items)).toEqual({
    first: ["chest", "subclass"],
    second: ["helm"],
  });
});

test("no exotic means a single batch", () => {
  expect(planEquipBatches(["a", "b"], [item({ itemInstanceId: "a" }), item({ itemInstanceId: "b" })])).toEqual({
    first: ["a", "b"],
    second: [],
  });
});

describe("planSpares", () => {
  const piece = (over: Partial<SparePieceLike>): SparePieceLike => ({
    instanceId: "x",
    itemHash: 1,
    slot: "helmet",
    location: "inventory",
    characterId: TARGET,
    isExotic: false,
    ...over,
  });
  type SparePieceLike = Parameters<typeof planSpares>[0] extends Iterable<infer T> ? T : never;

  test("lists unequipped same-slot pieces on the target, legendaries first, capped", () => {
    const staged = item({ itemInstanceId: "new-helm", itemHash: 9, location: "vault" });
    const pieces = [
      piece({ instanceId: "new-helm", itemHash: 9, location: "vault", characterId: undefined }),
      piece({ instanceId: "exotic", isExotic: true }),
      piece({ instanceId: "leg-1" }),
      piece({ instanceId: "worn", location: "equipped" }), // equipped: never a spare
      piece({ instanceId: "arms", slot: "arms" }), // wrong slot
      piece({ instanceId: "other-char", characterId: "char-B" }),
      piece({ instanceId: "leg-2" }),
      piece({ instanceId: "leg-3" }),
    ];
    expect(planSpares(pieces, [staged], TARGET)).toEqual({
      "new-helm": [
        { itemInstanceId: "leg-1", itemHash: 1, location: "inventory", characterId: TARGET },
        { itemInstanceId: "leg-2", itemHash: 1, location: "inventory", characterId: TARGET },
        { itemInstanceId: "leg-3", itemHash: 1, location: "inventory", characterId: TARGET },
      ],
    });
  });

  test("skips items already on the target, items not in the armory, and never offers a staged piece", () => {
    const onTarget = item({ itemInstanceId: "here", location: "inventory", characterId: TARGET });
    const subclass = item({ itemInstanceId: "subclass", location: "inventory", characterId: "char-B" });
    const fromVault = item({ itemInstanceId: "v", location: "vault" });
    const pieces = [
      piece({ instanceId: "here" }),
      piece({ instanceId: "v", location: "vault", characterId: undefined }),
      piece({ instanceId: "also-staged" }),
    ];
    expect(
      planSpares(pieces, [onTarget, subclass, fromVault, item({ itemInstanceId: "also-staged", location: "inventory", characterId: TARGET })], TARGET),
    ).toEqual({});
  });
});
