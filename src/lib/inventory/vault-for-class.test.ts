import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";
import { currentCharacterOnly, vaultForClass } from "./vault-for-class";

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

test("currentCharacterOnly leaves out the other characters' gear but keeps them listed", () => {
  const warlockHelm = piece("w", BUCKETS.helmet, 2);
  const titanHelm = piece("t", BUCKETS.helmet, 0);
  const gun = piece("g", BUCKETS.kinetic, 3);
  const warlock = {
    id: "1",
    classType: 2,
    equipped: { [BUCKETS.kinetic]: gun },
    inventory: { [BUCKETS.helmet]: [warlockHelm] },
    postmaster: [],
  };
  const titan = {
    id: "2",
    classType: 0,
    equipped: { [BUCKETS.helmet]: titanHelm },
    inventory: { [BUCKETS.kinetic]: [gun] },
    postmaster: [gun],
  };
  const inventory = {
    characters: [warlock, titan],
    vault: { [BUCKETS.helmet]: [warlockHelm, titanHelm] },
  } as unknown as ManagerInventory;

  const out = currentCharacterOnly(inventory, "1");
  expect(out.characters[0]).toBe(warlock);
  expect(out.characters[1]).toMatchObject({ id: "2", equipped: {}, inventory: {}, postmaster: [] });
  expect(out.vault[BUCKETS.helmet]).toEqual([warlockHelm]);
  expect(currentCharacterOnly(inventory, "nobody")).toBe(inventory);
});
