import { ARMOR_ROWS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";

/** classType for armor any class can wear. */
const ANY_CLASS = 3;

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
