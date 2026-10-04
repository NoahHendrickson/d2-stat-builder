"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  FloppyDiskIcon,
  Loading03Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { ActivitySet } from "@/lib/loadouts/activity-sets";
import type { ActivitySetRunState } from "@/lib/loadouts/activity-set-run";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** One activity set: its name and size, Run (or progress and Stop), and a menu. */
function ActivitySetTile({
  set,
  characters,
  run,
  canRun,
  onRun,
  onStop,
  onEdit,
  onDelete,
}: {
  set: ActivitySet;
  characters: ArmoryCharacter[];
  /** The run in progress, if it's this set's. */
  run: ActivitySetRunState | null;
  canRun: boolean;
  onRun: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const className = CLASS_NAMES[set.classType] ?? "Character";
  const missingCharacter = !characters.some((c) => c.id === set.characterId);
  const count = set.slots.length;

  return (
    <article
      aria-label={set.name}
      className="d2-card-frame flex w-64 shrink-0 flex-col gap-3 p-3 hover:[--line-alpha:1.6]"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-sm leading-5 font-medium">{set.name}</h3>
          <p className="text-muted-foreground truncate text-xs leading-4">
            {run
              ? run.stopping
                ? `Stopping after slot ${run.position} of ${run.total}`
                : `Saving ${run.position} of ${run.total}`
              : missingCharacter
                ? `${className} not found`
                : `${className}, ${count} ${count === 1 ? "loadout" : "loadouts"}`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-sm" variant="ghost" />}
            aria-label={`Actions for ${set.name}`}
          >
            <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit} disabled={!!run}>
              <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete} disabled={!!run}>
              <HugeiconsIcon icon={Delete02Icon} aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {run ? (
        <Button
          variant="outline"
          size="xs"
          className="h-8 gap-1.5"
          onClick={onStop}
          disabled={run.stopping}
        >
          <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
          Stop
        </Button>
      ) : (
        <Button
          variant="emphatic"
          size="xs"
          className="h-8 gap-1.5 px-4"
          onClick={onRun}
          disabled={!canRun || missingCharacter}
        >
          <HugeiconsIcon icon={FloppyDiskIcon} aria-hidden />
          Save in-game
        </Button>
      )}
    </article>
  );
}

/** What running a set will do, slot by slot, before anything is overwritten. */
function RunConfirmDialog({
  set,
  loadouts,
  onOpenChange,
  onConfirm,
}: {
  set: ActivitySet | null;
  loadouts: readonly SavedLoadout[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (set: ActivitySet) => void;
}) {
  return (
    <Dialog open={set !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>Save {set?.name} in-game?</DialogTitle>
          <DialogDescription>
            Each loadout is equipped on your {set ? (CLASS_NAMES[set.classType] ?? "character") : ""}{" "}
            in turn and saved over its in-game slot. You&apos;ll end up wearing the last one.
            Weapons a loadout doesn&apos;t set are saved as whatever you have on.
          </DialogDescription>
        </DialogHeader>
        {set && (
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
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => set && onConfirm(set)}>Equip and save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The player's activity sets, as a row of tiles above the loadout list. Running one
 * asks first (it overwrites in-game slots), then hands off to `onRun`.
 */
export function ActivitySetStrip({
  sets,
  characters,
  loadouts,
  run,
  canRun,
  onRun,
  onStop,
  onEdit,
  onDelete,
}: {
  sets: readonly ActivitySet[];
  characters: ArmoryCharacter[];
  loadouts: readonly SavedLoadout[];
  run: ActivitySetRunState | null;
  /** False while gear is still provisional or another apply is in flight. */
  canRun: boolean;
  onRun: (set: ActivitySet) => void;
  onStop: () => void;
  onEdit: (set: ActivitySet) => void;
  onDelete: (set: ActivitySet) => void;
}) {
  const [confirming, setConfirming] = useState<ActivitySet | null>(null);
  if (sets.length === 0) return null;

  return (
    <section aria-label="Activity sets" className="flex min-w-0 flex-col gap-2">
      <h2 className="d2-label">Activity sets</h2>
      <div className="d2-scroll -m-1 flex gap-3 overflow-x-auto p-1">
        {sets.map((set) => (
          <ActivitySetTile
            key={set.id}
            set={set}
            characters={characters}
            run={run?.setId === set.id ? run : null}
            canRun={canRun && !run}
            onRun={() => setConfirming(set)}
            onStop={onStop}
            onEdit={() => onEdit(set)}
            onDelete={() => onDelete(set)}
          />
        ))}
      </div>
      <RunConfirmDialog
        set={confirming}
        loadouts={loadouts}
        onOpenChange={(open) => !open && setConfirming(null)}
        onConfirm={(set) => {
          setConfirming(null);
          onRun(set);
        }}
      />
    </section>
  );
}
