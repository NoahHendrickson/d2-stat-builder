// The player's weapons, as far as saved loadouts need them: which slot each goes in,
// where it sits, and enough to draw it. Armor has its own (much richer) model in
// normalize.ts; this stays lean because a loadout only names and equips a weapon.
//
// Runtime imports are relative so the module runs under vitest.
import type { DestinyItemComponent, DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "../manifest/load";
import { itemWatermark, type ArmorLocation } from "./normalize";

export const WEAPON_SLOTS = ["kinetic", "energy", "power"] as const;
export type WeaponSlot = (typeof WEAPON_SLOTS)[number];

/** Weapon inventory bucket hash → slot. */
export const WEAPON_BUCKETS: Record<number, WeaponSlot> = {
  1498876634: "kinetic",
  2465295065: "energy",
  953998645: "power",
};
/** Slot → its character inventory bucket hash (the inverse of WEAPON_BUCKETS). */
export const WEAPON_SLOT_BUCKETS: Record<WeaponSlot, number> = {
  kinetic: 1498876634,
  energy: 2465295065,
  power: 953998645,
};
export const WEAPON_SLOT_LABELS: Record<WeaponSlot, string> = {
  kinetic: "Kinetic",
  energy: "Energy",
  power: "Power",
};

/** One owned weapon instance. */
export interface LoadoutWeapon {
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  watermark?: string;
  /** e.g. "Hand Cannon". */
  typeName: string;
  /** From the definition's bucket, so a vaulted weapon still knows its slot. */
  slot: WeaponSlot;
  isExotic: boolean;
  power?: number;
  location: ArmorLocation;
  characterId?: string;
  locked?: boolean;
  /** Sitting in the postmaster: listed under `inventory`, but not transferable. */
  postmaster?: boolean;
}

const POSTMASTER_BUCKET = 215593132;
const ITEM_STATE_LOCKED = 1;
const TIER_EXOTIC = 6;

/** The slot a weapon definition equips in; undefined for anything that isn't a weapon. */
export function weaponSlotOfHash(
  manifest: Pick<Manifest, "def">,
  itemHash: number | undefined,
): WeaponSlot | undefined {
  const bucket = manifest.def("DestinyInventoryItemDefinition", itemHash)?.inventory?.bucketTypeHash;
  return bucket === undefined ? undefined : WEAPON_BUCKETS[bucket];
}

/** Every weapon on the account (equipped + inventory + vault). */
export function normalizeWeapons(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): LoadoutWeapon[] {
  const weapons: LoadoutWeapon[] = [];
  const instances = profile.itemComponents?.instances?.data;

  const collect = (
    items: DestinyItemComponent[] | undefined,
    location: ArmorLocation,
    characterId?: string,
  ) => {
    for (const item of items ?? []) {
      if (!item.itemInstanceId) continue;
      const def = manifest.def("DestinyInventoryItemDefinition", item.itemHash);
      const slot = WEAPON_BUCKETS[def?.inventory?.bucketTypeHash ?? 0];
      if (!def || !slot) continue;
      const power = instances?.[item.itemInstanceId]?.primaryStat?.value;
      const watermark = itemWatermark(def, item.versionNumber);
      weapons.push({
        instanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        name: def.displayProperties.name,
        ...(def.displayProperties.icon ? { icon: def.displayProperties.icon } : {}),
        ...(watermark ? { watermark } : {}),
        typeName: def.itemTypeDisplayName ?? "",
        slot,
        isExotic: def.inventory?.tierType === TIER_EXOTIC,
        ...(typeof power === "number" ? { power } : {}),
        location,
        ...(characterId ? { characterId } : {}),
        ...((item.state ?? 0) & ITEM_STATE_LOCKED ? { locked: true } : {}),
        ...(item.bucketHash === POSTMASTER_BUCKET ? { postmaster: true } : {}),
      });
    }
  };

  for (const [charId, comp] of Object.entries(profile.characterEquipment?.data ?? {})) {
    collect(comp.items, "equipped", charId);
  }
  for (const [charId, comp] of Object.entries(profile.characterInventories?.data ?? {})) {
    collect(comp.items, "inventory", charId);
  }
  collect(profile.profileInventory?.data?.items, "vault");
  return weapons;
}
