"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { Manifest } from "@/lib/manifest/load";
import { clearInGameSlots } from "@/lib/loadouts/ingame-save";
import { inGameImportName } from "@/lib/loadouts/ingame-import";
import { toast } from "@/lib/toast";
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

/**
 * Delete in-game loadout slots. Lists one character's filled slots with a preview of
 * each; the player ticks the ones to delete, then confirms. Bungie empties each slot
 * (gear, name, icon and colour) one request a second; see clearInGameSlots. Saved
 * loadouts on the site are untouched.
 */
export function InGameDeleteDialog({
  open,
  onOpenChange,
  characters,
  manifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characters: ArmoryCharacter[];
  manifest: Manifest;
}) {
  const queryClient = useQueryClient();
  const picker = useInGameSlotPicker(characters, open);
  const { character, query, chosen, picked, setPick } = picker;
  // The second step: the picks are locked and the footer asks to confirm them.
  const [confirming, setConfirming] = useState(false);
  // Slots deleted so far in a running batch; null when idle.
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;
  const n = chosen.length;
  const what = n === 1 ? "1 in-game loadout" : `${n} in-game loadouts`;
  const className = character ? (CLASS_NAMES[character.classType] ?? "character") : "";

  const run = async () => {
    const data = query.data;
    if (!data || !character || query.isFetching || busy || n === 0) return;
    const targets = chosen;
    const nameOf = (index: number) =>
      inGameImportName(targets.find((s) => s.index === index)!, data.identifiers.names);
    setProgress(0);
    const { cleared, failure } = await clearInGameSlots({
      characterId: character.id,
      indexes: targets.map((s) => s.index),
      queryClient,
      onProgress: setProgress,
    });
    setProgress(null);
    setConfirming(false);
    if (failure) {
      // Emptied slots have already left the list; the rest stay ticked to retry.
      toast.error(
        cleared === 0
          ? `Couldn't delete ${nameOf(failure.index)}`
          : `Deleted ${cleared} of ${targets.length}`,
        failure.error,
      );
      if (failure.reauth) onOpenChange(false);
      return;
    }
    toast.success(
      cleared === 1 ? `Deleted ${nameOf(targets[0].index)}` : `Deleted ${cleared} in-game loadouts`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Delete in-game loadouts</DialogTitle>
          <DialogDescription>
            Pick the slots to empty in the game. This can&apos;t be undone. Loadouts saved
            here stay as they are.
          </DialogDescription>
        </DialogHeader>

        <InGameSlotPicker
          picker={picker}
          disabled={confirming || busy}
          renderRow={(slot, identifiers) => (
            <InGameSlotRow
              key={slot.index}
              slot={slot}
              identifiers={identifiers}
              manifest={manifest}
              picked={picked.has(slot.index)}
              onPick={(on) => setPick(slot.index, on)}
              disabled={confirming || busy}
              pickedClassName="bg-destructive/10"
              label={
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {inGameImportName(slot, identifiers.names)}
                  </span>
                  <span className="text-muted-foreground text-xs">Slot {slot.index + 1}</span>
                </span>
              }
            />
          )}
        />

        <DialogFooter className="sm:items-center">
          {confirming ? (
            <>
              <p role="alert" className="text-destructive text-sm sm:mr-auto">
                Delete {what} from your {className}? This can&apos;t be undone.
              </p>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void run()}
                disabled={n === 0 || query.isFetching || busy}
              >
                {busy ? (
                  <>
                    <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
                    Deleting {Math.min(progress + 1, n)} of {n}
                  </>
                ) : (
                  `Delete ${what}`
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirming(true)}
                disabled={n === 0 || query.isFetching}
              >
                {n > 1 ? `Delete ${n} loadouts` : "Delete loadout"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
