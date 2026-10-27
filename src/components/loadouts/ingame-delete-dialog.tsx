"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { mostRecentCharacter } from "@/lib/armory/character-for-class";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import type { InGameLoadoutIdentifiers, InGameLoadoutSlot } from "@/lib/bungie/ingame-loadouts";
import type { Manifest } from "@/lib/manifest/load";
import { clearInGameSlot, fetchInGameLoadouts } from "@/lib/loadouts/ingame-save";
import { inGameImportName } from "@/lib/loadouts/ingame-import";
import { toast } from "@/lib/toast";
import { CharacterEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { Emblem, SlotContents } from "@/components/loadouts/ingame-save-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Bungie asks for at least a second between loadout actions. */
const CLEAR_GAP_MS = 1000;

function SlotRow({
  slot,
  identifiers,
  manifest,
  picked,
  disabled,
  onPick,
}: {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  manifest: Manifest;
  picked: boolean;
  disabled: boolean;
  onPick: (picked: boolean) => void;
}) {
  const name = inGameImportName(slot, identifiers.names);
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 p-2 transition-colors",
        picked ? "bg-destructive/10" : "hover:bg-foreground/4",
      )}
    >
      <label className="flex min-w-40 flex-1 basis-40 cursor-pointer items-center gap-3">
        <Checkbox
          size="lg"
          checked={picked}
          disabled={disabled}
          onCheckedChange={(checked) => onPick(checked === true)}
        />
        <span aria-hidden className="relative size-10 shrink-0 overflow-hidden">
          <Emblem
            identifiers={identifiers}
            iconHash={slot.iconHash}
            colorHash={slot.colorHash}
            size={40}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="text-muted-foreground text-xs">Slot {slot.index + 1}</span>
        </span>
      </label>
      <SlotContents slot={slot} manifest={manifest} size={32} countMissing />
    </li>
  );
}

/**
 * Delete in-game loadout slots. Lists one character's filled slots with a preview of
 * each; the player ticks the ones to delete. Bungie empties each slot — gear, name, icon
 * and colour — one request a second. Saved loadouts on the site are untouched.
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
  const [characterId, setCharacterId] = useState(() => mostRecentCharacter(characters)?.id);
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  // Slots deleted so far in a running batch; null when idle.
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;
  const character = characters.find((c) => c.id === characterId);

  // Always refetched: deleting must target what the game holds right now.
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["ingame-loadouts", character?.id],
    queryFn: () => fetchInGameLoadouts(character!.id),
    enabled: open && !!character,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const filled = (data?.slots ?? []).filter((s) => !s.empty);
  const chosen = filled.filter((s) => picked.has(s.index));
  const allPicked = filled.length > 0 && chosen.length === filled.length;

  const setPick = (index: number, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  const run = async () => {
    if (!data || !character || isFetching || busy || chosen.length === 0) return;
    const names = data.identifiers.names;
    let done = 0;
    setProgress(0);
    for (const slot of chosen) {
      if (done > 0) await new Promise((r) => setTimeout(r, CLEAR_GAP_MS));
      const result = await clearInGameSlot(character.id, slot.index);
      if (!result.ok) {
        setProgress(null);
        setPicked((prev) => {
          const next = new Set(prev);
          for (const s of chosen.slice(0, done)) next.delete(s.index);
          return next;
        });
        toast.error(
          done === 0
            ? `Couldn't delete ${inGameImportName(slot, names)}`
            : `Deleted ${done} of ${chosen.length}`,
          result.error,
        );
        // The route cleared the dead session; forget the local player data too.
        if (result.reauth) {
          onOpenChange(false);
          void handleSessionExpired(queryClient);
        } else {
          void refetch();
        }
        return;
      }
      done++;
      setProgress(done);
    }
    setProgress(null);
    toast.success(
      done === 1
        ? `Deleted ${inGameImportName(chosen[0], names)}`
        : `Deleted ${done} in-game loadouts`,
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

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="d2-label">Character</h3>
            <CharacterEmblemTabs
              characters={characters}
              value={characterId ?? ""}
              onChange={(next) => {
                if (busy || next === characterId) return;
                setCharacterId(next);
                // Slot numbers belong to a character: picks don't carry over.
                setPicked(new Set());
              }}
            />
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-3">
              <h3 className="d2-label">In-game loadouts</h3>
              {filled.length > 1 && (
                <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={allPicked}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setPicked(checked ? new Set(filled.map((s) => s.index)) : new Set())
                    }
                  />
                  Select all
                </label>
              )}
            </div>
            {!character ? (
              <p className="text-muted-foreground text-sm">
                You don&apos;t have a character on this account yet.
              </p>
            ) : !data ? (
              error ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-destructive text-sm">{error.message}</p>
                  <Button size="sm" onClick={() => void refetch()} disabled={isFetching}>
                    Try again
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
                  Loading your in-game loadouts…
                </p>
              )
            ) : filled.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This character has nothing saved in its in-game loadouts.
              </p>
            ) : (
              <ul className="d2-scroll -mx-2 flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
                {filled.map((slot) => (
                  <SlotRow
                    key={slot.index}
                    slot={slot}
                    identifiers={data.identifiers}
                    manifest={manifest}
                    picked={picked.has(slot.index)}
                    disabled={busy}
                    onPick={(on) => setPick(slot.index, on)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void run()}
            disabled={chosen.length === 0 || isFetching || busy}
          >
            {busy ? (
              <>
                <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
                Deleting {progress + 1} of {chosen.length}
              </>
            ) : chosen.length > 1 ? (
              `Delete ${chosen.length} loadouts`
            ) : (
              "Delete loadout"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
