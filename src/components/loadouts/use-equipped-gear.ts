"use client";

import { useCallback, useMemo, useState } from "react";
import type { Armory, ArmoryCharacter } from "@/lib/armory/fetch";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { equippedGearAsLoadout } from "@/lib/loadouts/equipped-gear";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { useLoadoutMutations, withLoadoutToast } from "@/lib/loadouts/use-loadouts";
import type { GearLookups } from "@/components/loadouts/loadout-preview-frame";

/**
 * How a character is named on its Equipped gear row and card: the class, plus its Power
 * when another character shares the class.
 */
export function characterLabel(character: ArmoryCharacter, characters: readonly ArmoryCharacter[]): string {
  const className = CLASS_NAMES[character.classType] ?? "Guardian";
  const shared = characters.some((c) => c.id !== character.id && c.classType === character.classType);
  return shared ? `${className}, Power ${character.light}` : className;
}

/**
 * The Equipped gear card on the loadouts page: which character's gear is open, that
 * gear as an unsaved loadout (rebuilt as the armory refreshes), and saving it.
 */
export function useEquippedGear({
  armory,
  lookups,
  loadouts,
  enabled,
}: {
  armory: Armory;
  lookups: GearLookups;
  /** The player's loadouts, so the new one gets a name of its own. */
  loadouts: readonly SavedLoadout[];
  /** The card exists only where its rows do (the wide name column). */
  enabled: boolean;
}) {
  const { create } = useLoadoutMutations();
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const character = enabled ? armory.characters.find((c) => c.id === openId) : undefined;
  const { pieceMap, weaponMap, manifest } = lookups;

  const data = useMemo(
    () =>
      character &&
      equippedGearAsLoadout(character, {
        pieces: armory.pieces,
        weapons: armory.weapons ?? [],
        pieceMap,
        weaponMap,
        manifest,
        existingNames: loadouts.map((l) => l.loadout.name),
      }),
    [character, armory.pieces, armory.weapons, pieceMap, weaponMap, manifest, loadouts],
  );

  const toggle = useCallback(
    (c: ArmoryCharacter) => setOpenId((id) => (id === c.id ? null : c.id)),
    [],
  );
  const close = useCallback(() => setOpenId(null), []);

  const save = async () => {
    if (!character || !data) return;
    const savedId = character.id;
    setSavingId(savedId);
    await withLoadoutToast(
      "Saving loadout",
      () => create.mutateAsync(data),
      () => {
        // Only the card that was saved: another may have been opened meanwhile.
        setOpenId((id) => (id === savedId ? null : id));
        return ["Loadout saved", `Saved as ${data.loadout.name}`];
      },
    );
    setSavingId(null);
  };

  return {
    openId: character?.id,
    character,
    data,
    label: character ? characterLabel(character, armory.characters) : undefined,
    saving: character !== undefined && savingId === character.id,
    toggle,
    close,
    save,
  };
}
