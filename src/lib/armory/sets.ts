import type { Manifest } from "@/lib/manifest/load";
import { itemWatermark, type ArmorPiece } from "./normalize";
import { ARMOR_BUCKETS, type ArmorSlot } from "./stats";

export interface SetPerkInfo {
  requiredCount: number;
  name: string;
  description?: string;
}

export interface ArmorSetInfo {
  setHash: number;
  name: string;
  perks: SetPerkInfo[];
  /** How many pieces of this set the player owns (within the given list). */
  ownedCount: number;
}

/** Resolve the distinct armor sets present in `pieces` to names + 2pc/4pc perks. */
export function availableSets(
  pieces: ArmorPiece[],
  manifest: Manifest,
): ArmorSetInfo[] {
  const counts = new Map<number, number>();
  for (const p of pieces) {
    if (p.setHash) counts.set(p.setHash, (counts.get(p.setHash) ?? 0) + 1);
  }

  const sets: ArmorSetInfo[] = [];
  for (const [setHash, ownedCount] of counts) {
    const def = manifest.def("DestinyEquipableItemSetDefinition", setHash);
    if (!def) continue;
    const perks: SetPerkInfo[] = (def.setPerks ?? [])
      .map((sp) => {
        const perk = manifest.def(
          "DestinySandboxPerkDefinition",
          sp.sandboxPerkHash,
        );
        return {
          requiredCount: sp.requiredSetCount,
          name:
            perk?.displayProperties?.name ?? `${sp.requiredSetCount}-piece bonus`,
          description: perk?.displayProperties?.description || undefined,
        };
      })
      .sort((a, b) => a.requiredCount - b.requiredCount);

    sets.push({
      setHash,
      name: def.displayProperties?.name ?? "Unknown set",
      perks,
      ownedCount,
    });
  }

  return sets.sort((a, b) => b.ownedCount - a.ownedCount);
}

/** A set piece's look for one slot: its icon and season watermark. */
export interface SetSlotIcon {
  icon: string;
  watermark?: string;
}

/**
 * The set's own item icon per slot for one class, from the set definition's item list
 * (every class's pieces are listed; the first match per slot wins). Slots the manifest
 * has no iconned piece for are absent.
 */
export function setSlotIcons(
  manifest: Manifest,
  setHash: number,
  classType: number,
): Partial<Record<ArmorSlot, SetSlotIcon>> {
  const out: Partial<Record<ArmorSlot, SetSlotIcon>> = {};
  const set = manifest.def("DestinyEquipableItemSetDefinition", setHash);
  for (const itemHash of set?.setItems ?? []) {
    const def = manifest.def("DestinyInventoryItemDefinition", itemHash);
    if (!def || def.classType !== classType) continue;
    const slot =
      ARMOR_BUCKETS[def.inventory?.bucketTypeHash as keyof typeof ARMOR_BUCKETS];
    const icon = def.displayProperties?.icon;
    if (!slot || !icon || out[slot]) continue;
    out[slot] = { icon, watermark: itemWatermark(def) };
  }
  return out;
}
