"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FloppyDiskIcon,
  GameController03Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { Manifest } from "@/lib/manifest/load";
import type { ActivitySet } from "@/lib/loadouts/activity-sets";
import type { SetFooterStatus } from "@/lib/loadouts/set-draft";
import { loadoutSubclass } from "@/lib/loadouts/subclass";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { ArmorThumb } from "@/components/armor-thumb";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, SearchClearButton } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A saved loadout's icon in the picker: its subclass, else its exotic armor. */
function loadoutIcon(saved: SavedLoadout, manifest: Manifest): string | undefined {
  const hash = loadoutSubclass(saved.loadout)?.hash ?? saved.loadout.parameters.exoticArmorHash;
  return manifest.def("DestinyInventoryItemDefinition", hash)?.displayProperties.icon;
}

/** Search box over a list of saved loadouts; choosing one calls `onPick`. */
export function LoadoutPickList({
  options,
  manifest,
  selectedId,
  listLabel,
  onPick,
}: {
  options: readonly SavedLoadout[];
  manifest: Manifest;
  selectedId?: string;
  listLabel: string;
  onPick: (saved: SavedLoadout) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((l) => l.loadout.name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <>
      <div className="relative">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your loadouts"
          aria-label="Search your loadouts"
          autoFocus
          className="pr-8"
        />
        {query.length > 0 && <SearchClearButton onClick={() => setQuery("")} />}
      </div>
      <div
        role="listbox"
        aria-label={listLabel}
        className="d2-scroll flex max-h-80 flex-col overflow-y-auto overscroll-contain"
      >
        {shown.map((saved) => {
          const selected = saved.id === selectedId;
          return (
            <button
              key={saved.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onPick(saved)}
              className={cn(
                "hover:bg-foreground/6 focus-visible:bg-foreground/6 flex min-w-0 shrink-0 cursor-pointer items-center gap-2 p-1 text-left outline-none",
                selected && "bg-foreground/10",
              )}
            >
              <ArmorThumb icon={loadoutIcon(saved, manifest)} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm leading-5">
                {saved.loadout.name}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="text-muted-foreground p-2 text-xs">
            {query ? "No loadouts match." : "No saved loadouts for this class yet."}
          </p>
        )}
      </div>
    </>
  );
}

/** What running a set will do, slot by slot, before anything is overwritten. */
function RunConfirmDialog({
  set,
  open,
  loadouts,
  onOpenChange,
  onConfirm,
}: {
  set: ActivitySet;
  open: boolean;
  loadouts: readonly SavedLoadout[];
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>Apply {set.name} to the game?</DialogTitle>
          <DialogDescription>
            Each loadout is equipped on your {CLASS_NAMES[set.classType] ?? "character"} in turn
            and saved over its in-game slot. You&apos;ll end up wearing the last one. Weapons a
            loadout doesn&apos;t set are saved as whatever you have on.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-1.5 text-sm">
          {set.slots.map((s) => {
            const saved = loadouts.find((l) => l.id === s.loadoutId);
            return (
              <li key={s.index} className="flex min-w-0 items-baseline gap-3">
                <span className="d2-label w-12 shrink-0 text-[10px]">Slot {s.index + 1}</span>
                <span className={saved ? "truncate" : "text-warning truncate"}>
                  {saved ? saved.loadout.name : "Deleted loadout (skipped)"}
                </span>
              </li>
            );
          })}
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Apply in-game</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The bottom of an open set's card: what to do next and where it stands. Saving keeps the
 * set here and changes nothing in the game; applying does that (see runActivitySet), after
 * a confirmation.
 */
export function ActivitySetFooter({
  set,
  loadouts,
  status,
  saveAttention,
  onSaveAttentionEnd,
  onSave,
  onDiscard,
  onRun,
  onStop,
}: {
  /** The working copy; its name may still be blank. */
  set: ActivitySet;
  loadouts: readonly SavedLoadout[];
  status: SetFooterStatus;
  /** Above 0 pulses Save, pointing out what's unsaved; a new value replays it. */
  saveAttention: number;
  onSaveAttentionEnd: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onRun: (set: ActivitySet) => void;
  onStop: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {status.kind === "running" && (
        <Button variant="outline" className="w-full gap-1.5" onClick={onStop} disabled={status.stopping}>
          <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
          Stop
        </Button>
      )}
      {status.kind === "unsaved" && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDiscard} disabled={status.saving}>
            Discard
          </Button>
          <span className="relative flex min-w-0 flex-1">
            <Button variant="emphatic" className="w-full gap-1.5" onClick={onSave} disabled={!status.canSave}>
              <HugeiconsIcon
                icon={status.saving ? Loading03Icon : FloppyDiskIcon}
                className={cn(status.saving && "animate-spin")}
                aria-hidden
              />
              {status.isNew ? "Save set" : "Save changes"}
            </Button>
            {saveAttention > 0 && (
              <span
                key={saveAttention}
                aria-hidden
                className="d2-attention pointer-events-none absolute -inset-px z-10"
                onAnimationEnd={onSaveAttentionEnd}
              />
            )}
          </span>
        </div>
      )}
      {status.kind === "saved" && (
        <>
          <Button
            variant="emphatic"
            className="w-full gap-1.5"
            onClick={() => setConfirming(true)}
            disabled={!status.canApply}
          >
            <HugeiconsIcon icon={GameController03Icon} aria-hidden />
            Apply in-game
          </Button>
          <RunConfirmDialog
            set={set}
            open={confirming}
            loadouts={loadouts}
            onOpenChange={setConfirming}
            onConfirm={() => {
              setConfirming(false);
              onRun(set);
            }}
          />
        </>
      )}
      <div aria-live="polite" className="text-muted-foreground text-sm leading-5 tabular-nums empty:hidden">
        {status.kind === "running"
          ? status.stopping
            ? `Stopping after ${status.position} of ${status.total}`
            : `Applying ${status.position} of ${status.total}`
          : status.kind === "unsaved"
            ? status.message
            : null}
      </div>
    </div>
  );
}
