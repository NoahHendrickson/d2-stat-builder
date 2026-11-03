import { ANY_CLASS, ARMOR_ROWS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";

/**
 * `inventory` with the vault's armor cut to what a `classType` character can wear (its
 * own class's, and any class's). Weapons and everything else stay; so do the counts that
 * describe the whole vault (vaultCount, its capacity).
 */
export function vaultForClass(inventory: ManagerInventory, classType: number): ManagerInventory {
  const vault: Record<number, InventoryItem[]> = { ...inventory.vault };
  for (const { hash } of ARMOR_ROWS) {
    const items = vault[hash];
    if (items) vault[hash] = items.filter((i) => i.classType === classType || i.classType === ANY_CLASS);
  }
  return { ...inventory, vault };
}

/**
 * `inventory` as Current character shows it: the vault cut to `characterId`'s class
 * (vaultForClass), and every other character's gear left out. The other characters stay
 * listed, as places to move things to.
 */
export function currentCharacterOnly(inventory: ManagerInventory, characterId: string): ManagerInventory {
  const current = inventory.characters.find((c) => c.id === characterId);
  if (!current) return inventory;
  return {
    ...vaultForClass(inventory, current.classType),
    characters: inventory.characters.map((c) =>
      c === current ? c : { ...c, equipped: {}, inventory: {}, postmaster: [] },
    ),
  };
}
