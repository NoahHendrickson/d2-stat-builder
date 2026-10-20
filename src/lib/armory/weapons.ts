// The player's weapons, as far as saved loadouts need them: which slot each goes in,
// where it sits, and enough to draw it. Armor has its own (much richer) model in
// normalize.ts; this stays lean because a loadout only names and equips a weapon.
//
// Runtime imports are relative so the module runs under vitest.
import type { DestinyItemComponent, DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "../manifest/load";
import { weaponRoll } from "../inventory/weapon-details";
import { itemWatermark, type ArmorLocation } from "./normalize";
import { TIER_EXOTIC, WEAPON_BUCKETS, type WeaponSlot } from "./stats";

// The slots and their buckets live with the armor ones in stats.ts, which has no imports
// (the popularity crawl reads them without this module's).
export { WEAPON_BUCKETS, WEAPON_SLOT_BUCKETS, WEAPON_SLOTS, type WeaponSlot } from "./stats";
export const WEAPON_SLOT_LABELS: Record<WeaponSlot, string> = {
  kinetic: "Kinetic",
  energy: "Energy",
  power: "Power",
};

/**
 * A weapon's roll as plug hashes, for the picker to show on demand. Hashes keep it
 * light across a whole vault; names and icons come from the manifest when drawn.
 */
export interface WeaponPerks {
  /** Barrel through origin trait: the perk in the socket, and every perk it rolled with. */
  columns: { current: number; options: number[] }[];
}

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
  /** Absent when Bungie sent no sockets for it (or on an armory cached before perks). */
  perks?: WeaponPerks;
}

const POSTMASTER_BUCKET = 215593132;
const ITEM_STATE_LOCKED = 1;

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
      const roll = weaponRoll(profile, manifest, item.itemInstanceId);
      const perks: WeaponPerks | undefined =
        roll.columns.length > 0
          ? {
              columns: roll.columns.map((c) => ({
                current: c.current.hash,
                options: c.options.map((o) => o.hash),
              })),
            }
          : undefined;
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
        ...(perks ? { perks } : {}),
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
