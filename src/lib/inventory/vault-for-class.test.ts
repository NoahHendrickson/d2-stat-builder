import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";
import { vaultForClass } from "./vault-for-class";

const piece = (key: string, bucketHash: number, classType: number) =>
  ({ key, bucketHash, classType }) as InventoryItem;

test("vaultForClass keeps the class's armor and any class's, and leaves the rest", () => {
  const warlockHelm = piece("w", BUCKETS.helmet, 2);
  const titanHelm = piece("t", BUCKETS.helmet, 0);
  const anyHelm = piece("a", BUCKETS.helmet, 3);
  const hunterCloak = piece("h", BUCKETS.classItem, 1);
  const gun = piece("g", BUCKETS.kinetic, 3);
  const inventory = {
    characters: [],
    vault: {
      [BUCKETS.helmet]: [warlockHelm, titanHelm, anyHelm],
      [BUCKETS.classItem]: [hunterCloak],
      [BUCKETS.kinetic]: [gun],
    },
    vaultCount: 5,
  } as unknown as ManagerInventory;

  const out = vaultForClass(inventory, 2);
  expect(out.vault[BUCKETS.helmet]).toEqual([warlockHelm, anyHelm]);
  expect(out.vault[BUCKETS.classItem]).toEqual([]);
  expect(out.vault[BUCKETS.kinetic]).toBe(inventory.vault[BUCKETS.kinetic]);
  expect(out.vaultCount).toBe(5);
  // The input isn't touched.
  expect(inventory.vault[BUCKETS.helmet]).toHaveLength(3);
});
