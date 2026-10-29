"use client";

import { useState } from "react";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { LoadoutWeapon } from "@/lib/armory/weapons";
import type { InGameLoadoutSlot } from "@/lib/bungie/ingame-loadouts";
import type { Manifest } from "@/lib/manifest/load";
import { inGameImportName, inGameSlotToLoadout } from "@/lib/loadouts/ingame-import";
import { MAX_NAME_LENGTH, type SavedLoadoutData } from "@/lib/loadouts/types";
import {
  InGameSlotPicker,
  InGameSlotRow,
  useInGameSlotPicker,
} from "@/components/loadouts/ingame-slot-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Copy in-game loadout slots into saved loadouts. Lists one character's filled slots
 * with a preview of each; the player ticks the ones they want and can rename them
 * (the game only offers its fixed list of names). Nothing in the game changes.
 */
export function InGameImportDialog({
  open,
  onOpenChange,
  characters,
  pieceMap,
  weaponMap,
  manifest,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characters: ArmoryCharacter[];
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  weaponMap: ReadonlyMap<string, LoadoutWeapon>;
  manifest: Manifest;
  onImport: (loadouts: SavedLoadoutData[]) => void;
}) {
  // The player's own names, by slot index; a slot not renamed keeps the in-game name.
  const [names, setNames] = useState<ReadonlyMap<number, string>>(() => new Map());
  // Slot numbers belong to a character: names don't carry over.
  const picker = useInGameSlotPicker(characters, open, () => setNames(new Map()));
  const { character, query, chosen, picked, setPick } = picker;
  const { data, isFetching } = query;
  const nameFor = (slot: InGameLoadoutSlot) =>
    names.get(slot.index) ?? (data ? inGameImportName(slot, data.identifiers.names) : "");

  const confirm = () => {
    if (!data || !character || isFetching || chosen.length === 0) return;
    const loadouts = chosen.map((slot) =>
      inGameSlotToLoadout({
        slot,
        // A name cleared to nothing falls back to the in-game one.
        name: nameFor(slot).trim() || inGameImportName(slot, data.identifiers.names),
        classType: character.classType,
        pieceMap,
        weaponMap,
        manifest,
      }),
    );
    onOpenChange(false);
    onImport(loadouts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Import in-game loadouts</DialogTitle>
          <DialogDescription>
            Pick the slots to save here. Each keeps its subclass setup, weapons, armor, mods
            and artifact. Your in-game loadouts stay as they are.
          </DialogDescription>
        </DialogHeader>

        <InGameSlotPicker
          picker={picker}
          renderRow={(slot, identifiers) => {
            const inGameName = inGameImportName(slot, identifiers.names);
            const isPicked = picked.has(slot.index);
            return (
              <InGameSlotRow
                key={slot.index}
                slot={slot}
                identifiers={identifiers}
                manifest={manifest}
                picked={isPicked}
                onPick={(on) => setPick(slot.index, on)}
                checkboxLabel={`Import slot ${slot.index + 1}, ${inGameName}`}
              >
                <Input
                  value={nameFor(slot)}
                  onChange={(e) =>
                    setNames((prev) => new Map(prev).set(slot.index, e.target.value))
                  }
                  onFocus={() => !isPicked && setPick(slot.index, true)}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder={inGameName}
                  aria-label={`Name for slot ${slot.index + 1}`}
                  className="min-w-40 flex-1 basis-40"
                />
              </InGameSlotRow>
            );
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={chosen.length === 0 || isFetching}>
            {chosen.length > 1 ? `Import ${chosen.length} loadouts` : "Import loadout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
