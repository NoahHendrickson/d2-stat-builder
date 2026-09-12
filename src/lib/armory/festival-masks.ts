/**
 * Festival of the Lost masks (Masquerader's Helm / Cowl / Hood). They occupy the
 * helmet slot, roll real armor stats, and live in inventory/vault — not Collections.
 *
 * Live defs are not `itemType` Armor (D2ArmorPicker keeps them via the helmet
 * bucket) and are not always tagged Mask (DIM patches them via extended-ich), so
 * we match known hashes, category 55, the "Festival Mask" type name, and the
 * Masquerader's piece names.
 */
import type { ArmorSlot } from "./stats";

/** DestinyItemCategoryDefinition: Mask. */
export const FESTIVAL_MASK_CATEGORY_HASH = 55;

/**
 * Masquerader's Helm / Cowl / Hood hashes across years (DIM `extended-ich.json`
 * entries mapped to Mask). Newer defs are also accepted via name / type / category.
 */
export const FESTIVAL_MASK_HASHES: ReadonlySet<number> = new Set([
  199733460, 239189018, 2213504923, 2352138838, 2390807586, 2462335932,
  2545426109, 3224066584, 4095816113,
]);

const MASQUERADER_NAME = /^Masquerader's (Hood|Helm|Cowl)$/i;

/** Fields we read from DestinyInventoryItemDefinition (and test stubs). */
export type FestivalMaskDef = {
  hash?: number;
  itemCategoryHashes?: number[];
  itemTypeDisplayName?: string;
  displayProperties?: { name?: string };
} | null;

export function isFestivalMask(
  itemHash: number,
  def?: FestivalMaskDef,
): boolean {
  if (FESTIVAL_MASK_HASHES.has(itemHash)) return true;
  if (def?.hash != null && FESTIVAL_MASK_HASHES.has(def.hash)) return true;
  if (def?.itemCategoryHashes?.includes(FESTIVAL_MASK_CATEGORY_HASH) === true) {
    return true;
  }
  if (def?.itemTypeDisplayName === "Festival Mask") return true;
  const name = def?.displayProperties?.name;
  return Boolean(name && MASQUERADER_NAME.test(name));
}

/** True when any of `hashes` is an owned helmet in `pieces`. */
export function hashesIncludeHelmet(
  hashes: number[],
  pieces: { itemHash: number; slot: ArmorSlot }[],
): boolean {
  const set = new Set(hashes);
  return pieces.some((p) => p.slot === "helmet" && set.has(p.itemHash));
}
