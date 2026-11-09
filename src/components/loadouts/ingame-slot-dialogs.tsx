"use client";

import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import type {
  InGameLoadoutIdentifiers,
  InGameLoadoutSlot,
  SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import type { ActivitySet } from "@/lib/loadouts/activity-sets";
import { inGameImportName } from "@/lib/loadouts/ingame-import";
import type { InGameSlotChoice } from "@/lib/loadouts/ingame-save";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { LoadoutPickList } from "@/components/loadouts/activity-set-panel";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import { InGameSaveDialog, SlotCustomizeDialog } from "@/components/loadouts/ingame-save-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SlotDialog =
  | { kind: "none" }
  | { kind: "pick"; slot: InGameLoadoutSlot }
  | { kind: "save"; slot: InGameLoadoutSlot; saved: SavedLoadout }
  | { kind: "delete"; slot: InGameLoadoutSlot }
  | { kind: "customize"; slot: InGameLoadoutSlot }
  | { kind: "customize-set-slot"; slot: InGameLoadoutSlot }
  | { kind: "delete-set"; set: ActivitySet };

/** The confirmations and pickers the In-game tab opens over itself. */
export function InGameSlotDialogs({
  dialog,
  setDialog,
  identifiers,
  character,
  options,
  manifest,
  onSaveToSlot,
  onCustomizeSlot,
  onLabelSetSlot,
  onDeleteSlot,
  onDeleteSet,
}: {
  dialog: SlotDialog;
  setDialog: (dialog: SlotDialog) => void;
  identifiers: InGameLoadoutIdentifiers | undefined;
  character: ArmoryCharacter | undefined;
  options: readonly SavedLoadout[];
  manifest: Manifest;
  onSaveToSlot: (saved: SavedLoadout, choice: InGameSlotChoice) => void;
  onCustomizeSlot: (slot: InGameLoadoutSlot, labels: SlotIdentifiers) => void;
  onLabelSetSlot: (index: number, labels: SlotIdentifiers) => void;
  onDeleteSlot: (slot: InGameLoadoutSlot) => void;
  onDeleteSet: (set: ActivitySet) => void;
}) {
  const close = (open: boolean) => {
    if (!open) setDialog({ kind: "none" });
  };
  const closeAnd = (action: () => void) => {
    setDialog({ kind: "none" });
    action();
  };

  return (
    <>
      {dialog.kind === "pick" && (
        <Dialog open onOpenChange={close}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="pr-8">
              <DialogTitle>
                {dialog.slot.empty ? "Save a loadout to" : "Replace"} slot {dialog.slot.index + 1}
              </DialogTitle>
              <DialogDescription>
                Pick the Conflux loadout to equip and save into this slot.
              </DialogDescription>
            </DialogHeader>
            <LoadoutPickList
              options={options}
              manifest={manifest}
              listLabel={`Loadouts for slot ${dialog.slot.index + 1}`}
              onPick={(saved) => setDialog({ kind: "save", slot: dialog.slot, saved })}
            />
          </DialogContent>
        </Dialog>
      )}
      {dialog.kind === "save" && character && (
        <InGameSaveDialog
          open
          onOpenChange={close}
          loadoutName={dialog.saved.loadout.name}
          character={character}
          manifest={manifest}
          initialSlotIndex={dialog.slot.index}
          onConfirm={(choice) => onSaveToSlot(dialog.saved, choice)}
        />
      )}
      {dialog.kind === "customize" && identifiers && (
        <SlotCustomizeDialog
          slot={dialog.slot}
          identifiers={identifiers}
          onOpenChange={close}
          onConfirm={(labels) => closeAnd(() => onCustomizeSlot(dialog.slot, labels))}
        />
      )}
      {dialog.kind === "customize-set-slot" && identifiers && (
        <SlotCustomizeDialog
          slot={dialog.slot}
          identifiers={identifiers}
          description="What this slot is called and how it looks in the game once the set is applied."
          onOpenChange={close}
          onConfirm={(labels) => closeAnd(() => onLabelSetSlot(dialog.slot.index, labels))}
        />
      )}
      <ConfirmDialog
        open={dialog.kind === "delete"}
        onOpenChange={close}
        title="Delete in-game loadout?"
        description={
          dialog.kind === "delete" && identifiers
            ? `${inGameImportName(dialog.slot, identifiers.names)} in slot ${dialog.slot.index + 1} will be emptied in the game. This can't be undone. Loadouts saved in Conflux stay as they are.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={() => dialog.kind === "delete" && closeAnd(() => onDeleteSlot(dialog.slot))}
      />
      <ConfirmDialog
        open={dialog.kind === "delete-set"}
        onOpenChange={close}
        title="Delete activity set?"
        description={
          dialog.kind === "delete-set"
            ? `“${dialog.set.name}” will be removed. Your loadouts and in-game slots stay as they are.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={() => dialog.kind === "delete-set" && closeAnd(() => onDeleteSet(dialog.set))}
      />
    </>
  );
}
