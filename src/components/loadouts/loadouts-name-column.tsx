"use client";

import { useCallback } from "react";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { EquippedGearList } from "@/components/loadouts/equipped-gear-list";
import { LoadoutIndex } from "@/components/loadouts/loadout-index";

/**
 * The loadouts page's left column (wide screens): each character's Equipped gear, then
 * the shown loadouts by name. Jumping to a loadout closes the Equipped gear card, so the
 * list is back on its own.
 */
export function LoadoutsNameColumn({
  characters,
  blockedLabel,
  equippedOpenId,
  onToggleEquipped,
  onCloseEquipped,
  loadouts,
  activeId,
  onJump,
}: {
  characters: readonly ArmoryCharacter[];
  blockedLabel?: string;
  equippedOpenId: string | undefined;
  onToggleEquipped: (character: ArmoryCharacter) => void;
  onCloseEquipped: () => void;
  loadouts: readonly SavedLoadout[];
  activeId: string | undefined;
  onJump: (index: number) => void;
}) {
  const jump = useCallback(
    (index: number) => {
      onCloseEquipped();
      onJump(index);
    },
    [onCloseEquipped, onJump],
  );
  return (
    <div className="flex min-h-0 w-56 shrink-0 flex-col gap-4">
      <EquippedGearList
        characters={characters}
        blockedLabel={blockedLabel}
        openId={equippedOpenId}
        onOpen={onToggleEquipped}
      />
      {loadouts.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <h2 className="d2-label shrink-0 px-1">Loadouts</h2>
          <LoadoutIndex loadouts={loadouts} activeId={activeId} onJump={jump} className="flex-1" />
        </div>
      )}
    </div>
  );
}
