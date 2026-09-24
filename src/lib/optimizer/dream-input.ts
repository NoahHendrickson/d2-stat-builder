/**
 * The dream query for one build (see dream.ts): each slot holds only that build's piece,
 * so k new pieces = k of its pieces replaced, under the builder's other settings.
 */
import type { ArmorArchetype } from "../armory/archetypes";
import { intrinsicStats, type ArmorPiece } from "../armory/normalize";
import { ARMOR_SLOTS } from "../armory/stats";
import type { Manifest } from "../manifest/load";
import type { DreamExotic, DreamInput } from "./dream";
import { armorToOptimizerPiece } from "./from-armory";
import type { OptimizerInput } from "./types";

/** The builder settings a dream search carries over (everything but pieces and targets). */
export type DreamSettings = Pick<
  OptimizerInput,
  "mods" | "setRequirements" | "allowTuning" | "allowBalancedTuning" | "fragmentBonus" | "powerRange"
>;

const CLASS_ITEM_SLOT = ARMOR_SLOTS.indexOf("classItem");

/**
 * The build's exotic stays its exotic, or is re-rolled in its own slot; a build without
 * one stays without. A class item that's an exotic (its roll comes from Spirit perks) or
 * pinned to Dreamer's Bond is never replaced. Null when a piece is missing.
 */
export function dreamInputForBuild({
  pieces,
  targets,
  settings,
  archetypes,
  manifest,
  classItemPinned,
}: {
  /** The build's pieces, one per slot (ARMOR_SLOTS order). */
  pieces: (ArmorPiece | undefined)[];
  targets: number[];
  settings: DreamSettings;
  archetypes: ArmorArchetype[];
  manifest: Manifest;
  /** The class item slot is pinned (Dreamer's Bond). */
  classItemPinned: boolean;
}): DreamInput | null {
  if (pieces.some((p) => !p)) return null;
  const owned = pieces as ArmorPiece[];
  const exoticSlot = owned.findIndex((p) => p.isExotic);
  const exoticPiece = exoticSlot >= 0 ? owned[exoticSlot] : undefined;
  const exotic: DreamExotic =
    exoticPiece && exoticSlot !== CLASS_ITEM_SLOT
      ? {
          kind: "specific",
          slot: exoticSlot,
          hash: exoticPiece.itemHash,
          name: exoticPiece.name,
          // The dream roll is Tier 5, so the def-level bonus always applies — read it
          // from the definition, not the instance (whose stats carry it only at Tier 5).
          // A legacy copy's definition isn't the Armor 3.0 item, so it gets none.
          intrinsic:
            exoticPiece.archetype !== undefined
              ? intrinsicStats(
                  manifest.def("DestinyInventoryItemDefinition", exoticPiece.itemHash) ?? {},
                )
              : [0, 0, 0, 0, 0, 0],
        }
      : { kind: "none" };
  return {
    base: {
      ...settings,
      slots: owned.map((p) => [armorToOptimizerPiece(p)]),
      minimums: targets,
      exotic: exoticPiece
        ? { mode: "specific", hashes: [exoticPiece.itemHash] }
        : { mode: "none" },
    },
    archetypes,
    exotic,
    lockedSlots:
      exoticSlot === CLASS_ITEM_SLOT || classItemPinned ? [CLASS_ITEM_SLOT] : [],
  };
}
