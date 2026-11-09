"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Armory, ArmoryCharacter } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import type {
  InGameLoadoutIdentifiers,
  InGameLoadoutSlot,
  SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import { inGameImportName } from "@/lib/loadouts/ingame-import";
import {
  clearInGameSlots,
  relabelInGameSlot,
  rereadInGameSlots,
  saveLoadoutInGame,
  type InGameSlotChoice,
} from "@/lib/loadouts/ingame-save";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { toast } from "@/lib/toast";

/** What can be done to a character's slots in the game itself. */
export function useSlotActions({
  armory,
  character,
  identifiers,
  pieceMap,
  weaponMap,
  manifest,
  provisional,
  blocked,
  onArmoryChanged,
}: {
  armory: Armory;
  character: ArmoryCharacter | undefined;
  identifiers: InGameLoadoutIdentifiers | undefined;
  pieceMap: Parameters<typeof resolveLoadout>[1];
  weaponMap: Parameters<typeof resolveLoadout>[3];
  manifest: Manifest;
  provisional: boolean;
  /** An activity set is being applied. */
  blocked: boolean;
  onArmoryChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);

  /** Equip a saved loadout and save it into a slot (see saveLoadoutInGame). */
  const saveToSlot = async (saved: SavedLoadout, choice: InGameSlotChoice) => {
    if (!character || provisional || applying || blocked) return;
    const resolved = resolveLoadout(saved.loadout, pieceMap, manifest, weaponMap);
    if (!resolved.actionable) {
      toast.warning(
        "Not saved in-game",
        `${saved.loadout.name} has armor that isn't in your inventory`,
      );
      return;
    }
    setApplying(true);
    try {
      const outcome = await saveLoadoutInGame({
        saved,
        resolved,
        character,
        armory: armory.pieces,
        weapons: armory.weapons,
        manifest,
        queryClient,
        choice,
      });
      if (outcome) onArmoryChanged();
    } catch {
      toast.error("Apply failed — check your connection and try again");
    } finally {
      setApplying(false);
    }
    rereadInGameSlots(queryClient, character.id);
  };

  const customizeSlot = async (slot: InGameLoadoutSlot, labels: SlotIdentifiers) => {
    if (!character) return;
    const pending = toast.loading(`Updating slot ${slot.index + 1}`);
    const result = await relabelInGameSlot({
      characterId: character.id,
      choice: { loadoutIndex: slot.index, ...labels },
      queryClient,
    });
    if (result.ok) {
      pending.success(`Slot ${slot.index + 1} updated`);
      rereadInGameSlots(queryClient, character.id);
    } else {
      pending.error(`Couldn't update slot ${slot.index + 1}`, result.error);
    }
  };

  const deleteSlot = async (slot: InGameLoadoutSlot) => {
    if (!character || !identifiers) return;
    const name = inGameImportName(slot, identifiers.names);
    const { failure } = await clearInGameSlots({
      characterId: character.id,
      indexes: [slot.index],
      queryClient,
    });
    if (failure) toast.error(`Couldn't delete ${name}`, failure.error);
    else toast.success(`Deleted ${name}`);
  };

  return { applying, saveToSlot, customizeSlot, deleteSlot };
}
