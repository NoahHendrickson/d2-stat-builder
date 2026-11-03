import { expect, test } from "vitest";
import { ARMOR_ROWS, CHARACTER_GROUPS, SLOT_ROWS, WEAPON_ROWS, groupsForVaultTab, slotRowsForVaultTab } from "./buckets";

test("a vault tab covers its own group's slots, All every one", () => {
  expect(groupsForVaultTab("all")).toBe(CHARACTER_GROUPS);
  expect(groupsForVaultTab("weapons").flatMap((g) => g.rows)).toEqual(WEAPON_ROWS);
  expect(slotRowsForVaultTab("all")).toBe(SLOT_ROWS);
  expect(slotRowsForVaultTab("weapons").map((r) => r.row)).toEqual(WEAPON_ROWS);
  const armor = slotRowsForVaultTab("armor");
  expect(armor.map((r) => r.row)).toEqual(ARMOR_ROWS);
  // The first armor slot still opens its group (a wider gap above it).
  expect(armor[0]?.groupStart).toBe(true);
});
