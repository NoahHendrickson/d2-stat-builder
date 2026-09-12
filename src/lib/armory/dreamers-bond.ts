/**
 * Collections 21-power class items (Dreamer's Bond / Cloak / Mark). Year-1 commons
 * with no armor stats — used as a builder constraint so the other four pieces have
 * to hit the targets without a class-item roll.
 */
import type { Manifest } from "@/lib/manifest/load";
import { SYNTHETIC_CLASS_ITEM_ID_PREFIX } from "./exotic-class-perks";
import type { ArmorPiece } from "./normalize";
import type { StatArray } from "./stats";

/** Collections power; not infused. Documented here so the UI copy stays in sync. */
export const DREAMERS_BOND_POWER = 21;

const ZERO: StatArray = [0, 0, 0, 0, 0, 0];

/** Titan / Hunter / Warlock collections class items. */
export const DREAMERS_CLASS_ITEMS: Record<number, { hash: number; name: string }> =
  {
    0: { hash: 2426340790, name: "Dreamer's Mark" },
    1: { hash: 11686456, name: "Dreamer's Cloak" },
    2: { hash: 320310251, name: "Dreamer's Bond" },
  };

export const DREAMERS_BOND_ID_PREFIX = `${SYNTHETIC_CLASS_ITEM_ID_PREFIX}dreamers:`;

export function isDreamersBondId(id: string): boolean {
  return id.startsWith(DREAMERS_BOND_ID_PREFIX);
}

export function dreamersClassItemName(classType: number): string {
  return DREAMERS_CLASS_ITEMS[classType]?.name ?? "Dreamer's Bond";
}

/**
 * Hardcoded 0-stat class item for the optimizer. Synthetic id — no live instance.
 * `manifest` is optional; used only for the icon / canonical name.
 */
export function dreamersBondPiece(
  classType: number,
  manifest?: Manifest | null,
): ArmorPiece | null {
  const spec = DREAMERS_CLASS_ITEMS[classType];
  if (!spec) return null;
  const def = manifest?.def("DestinyInventoryItemDefinition", spec.hash);
  return {
    instanceId: `${DREAMERS_BOND_ID_PREFIX}${spec.hash}`,
    itemHash: spec.hash,
    name: def?.displayProperties?.name ?? spec.name,
    icon: def?.displayProperties?.icon,
    slot: "classItem",
    classType,
    isExotic: false,
    isArtifice: false,
    baseStats: [...ZERO],
    stats: [...ZERO],
    location: "vault",
  };
}
