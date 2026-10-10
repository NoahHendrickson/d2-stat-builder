import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";
import { applyLocks, settledLocks, type LockOp } from "./lock-queue";

const item = (key: string, locked = false): InventoryItem => ({
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
  locked,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
});

const inv = (): ManagerInventory => ({
  characters: [
    {
      id: "c",
      classType: 0,
      light: 0,
      emblemBackgroundPath: "",
      emblemPath: "",
      dateLastPlayed: "",
      stats: {},
      equipped: { [BUCKETS.kinetic]: item("eq") },
      inventory: { [BUCKETS.kinetic]: [item("inv")] },
      postmaster: [],
    },
  ],
  vault: { [BUCKETS.kinetic]: [item("v1", true), item("v2")] },
  vaultCount: 2,
  account: {},
  accountCapacity: {},
  currencies: [],
});

const op = (id: number, instanceId: string, locked: boolean, extra: Partial<LockOp> = {}): LockOp => ({
  id,
  instanceId,
  locked,
  status: "done",
  at: 0,
  ...extra,
});

test("applyLocks sets the latest state per item and leaves untouched lists alone", () => {
  const base = inv();
  const next = applyLocks(base, [op(1, "eq", true), op(2, "v1", false), op(3, "eq", false), op(4, "eq", true)]);
  expect(next.characters[0].equipped[BUCKETS.kinetic].locked).toBe(true);
  expect(next.vault[BUCKETS.kinetic].map((i) => i.locked)).toEqual([false, false]);
  expect(next.characters[0].inventory).toBe(base.characters[0].inventory);
  expect(applyLocks(base, [op(1, "v1", true)])).toBe(base);
});

test("settledLocks drops done ops the profile shows, gone items, and stale ones", () => {
  const base = inv();
  const ops = [
    op(1, "v1", true), // profile agrees
    op(2, "v2", true), // not yet
    op(3, "v2", true, { status: "pending" }),
    op(4, "gone", true),
    op(5, "inv", true, { at: -10 * 60_000 }),
  ];
  expect([...settledLocks(base, ops, 0)].sort()).toEqual([1, 4, 5]);
});
