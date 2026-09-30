// Perk names per item for the manager search: a weapon's frame, every perk it rolled
// (not just the ones selected), and its mods; for other gear, whatever is plugged.
// Origin traits are also kept on their own for `origin:`.
// Built lazily, item by item, the first time a search needs them.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import type { InventoryItem } from "./build";
import { weaponRoll } from "./weapon-details";

const ITEM_TYPE_WEAPON = 3;
const NONE: readonly string[] = [];

interface ItemPerks {
  perks: readonly string[];
  origins: readonly string[];
}
const EMPTY: ItemPerks = { perks: NONE, origins: NONE };

export interface PerkLookup {
  /** Lower-case perk names on the item. */
  perks(item: InventoryItem): readonly string[];
  /** Lower-case origin trait names a weapon has (one, or two on newer weapons). */
  origins(item: InventoryItem): readonly string[];
}

export const NO_PERKS: PerkLookup = { perks: () => NONE, origins: () => NONE };

export function createPerkLookup(profile: DestinyProfileResponse, manifest: Manifest): PerkLookup {
  const cache = new Map<string, ItemPerks>();
  const lookup = (item: InventoryItem): ItemPerks => {
    const id = item.instanceId;
    if (!id) return EMPTY;
    let entry = cache.get(id);
    if (entry) return entry;
    if (item.itemType === ITEM_TYPE_WEAPON) {
      const roll = weaponRoll(profile, manifest, id);
      entry = {
        perks: [
          ...(roll.frame ? [roll.frame.name] : []),
          ...roll.columns.flatMap((c) => c.options.map((o) => o.name)),
          ...roll.mods.map((m) => m.name),
        ].map((n) => n.toLowerCase()),
        origins: roll.columns
          .filter((c) => c.origin)
          .flatMap((c) => c.options.map((o) => o.name.toLowerCase())),
      };
    } else {
      const perks = (profile.itemComponents?.sockets?.data?.[id]?.sockets ?? []).flatMap((s) => {
        const name = s.plugHash
          ? manifest.def("DestinyInventoryItemDefinition", s.plugHash)?.displayProperties?.name
          : undefined;
        return name ? [name.toLowerCase()] : [];
      });
      entry = { perks, origins: NONE };
    }
    cache.set(id, entry);
    return entry;
  };
  return { perks: (item) => lookup(item).perks, origins: (item) => lookup(item).origins };
}
