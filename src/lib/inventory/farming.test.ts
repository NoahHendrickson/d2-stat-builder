import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "./build";
import { farmingPlans } from "./farming";

const item = (key: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  key,
  instanceId: key,
  itemHash: 1,
  name: key,
  typeName: "",
  itemType: 3,
  classType: 3,
  tierType: 5,
  bucketHash: BUCKETS.kinetic,
  quantity: 1,
  power: 400,
  locked: false,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
  ...extra,
});

const hunter = (inventory: ManagerCharacter["inventory"]): ManagerCharacter => ({
  id: "H",
  classType: 1,
  light: 0,
  emblemBackgroundPath: "",
  emblemPath: "",
  dateLastPlayed: "",
  stats: {},
  equipped: {},
  inventory,
  postmaster: [],
});

const inv = (c: ManagerCharacter, vaultCount = 0, vaultCapacity = 700): ManagerInventory => ({
  characters: [c],
  vault: {},
  vaultCount,
  vaultCapacity,
  account: {},
  accountCapacity: {},
  currencies: [],
});

test("vaults the least wanted items until each bucket has a free slot", () => {
  const kinetic = Array.from({ length: 9 }, (_, i) => item(`k${i}`, { power: 400 + i }));
  const energy = Array.from({ length: 8 }, (_, i) => item(`e${i}`, { bucketHash: BUCKETS.energy }));
  const plans = farmingPlans(inv(hunter({ [BUCKETS.kinetic]: kinetic, [BUCKETS.energy]: energy })), "H", {
    annotations: { k0: { tag: "favorite" } },
  });
  expect(plans.map((p) => p.map((s) => s.item.key))).toEqual([["k1"]]);

  const two = farmingPlans(inv(hunter({ [BUCKETS.kinetic]: kinetic })), "H", { annotations: {} }, 2);
  expect(two.map((p) => p[0]!.item.key)).toEqual(["k0", "k1"]);
});

test("stops when the vault is full and nothing else can take its items", () => {
  const kinetic = Array.from({ length: 9 }, (_, i) => item(`k${i}`));
  expect(farmingPlans(inv(hunter({ [BUCKETS.kinetic]: kinetic }), 700, 700), "H", { annotations: {} })).toEqual([]);
});
