// Perk names per item for the manager search: a weapon's frame, every perk it rolled
// (not just the ones selected), and its mods; for other gear, whatever is plugged.
// Built lazily, item by item, the first time a search needs them.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import type { InventoryItem } from "./build";
import { weaponRoll } from "./weapon-details";

const ITEM_TYPE_WEAPON = 3;
const NONE: readonly string[] = [];

export function createPerkLookup(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): (item: InventoryItem) => readonly string[] {
  const cache = new Map<string, readonly string[]>();
  return (item) => {
    const id = item.instanceId;
    if (!id) return NONE;
    let names = cache.get(id);
    if (names) return names;
    if (item.itemType === ITEM_TYPE_WEAPON) {
      const roll = weaponRoll(profile, manifest, id);
      names = [
        ...(roll.frame ? [roll.frame.name] : []),
        ...roll.columns.flatMap((c) => c.options.map((o) => o.name)),
        ...roll.mods.map((m) => m.name),
      ];
    } else {
      names = (profile.itemComponents?.sockets?.data?.[id]?.sockets ?? []).flatMap((s) => {
        const name = s.plugHash
          ? manifest.def("DestinyInventoryItemDefinition", s.plugHash)?.displayProperties?.name
          : undefined;
        return name ? [name] : [];
      });
    }
    names = names.map((n) => n.toLowerCase());
    cache.set(id, names);
    return names;
  };
}
