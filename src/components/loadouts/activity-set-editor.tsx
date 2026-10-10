"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { characterForClass } from "@/lib/armory/character-for-class";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { Manifest } from "@/lib/manifest/load";
import type { InGameLoadoutIdentifiers, InGameLoadoutSlot } from "@/lib/bungie/ingame-loadouts";
import { fetchInGameLoadouts } from "@/lib/loadouts/ingame-save";
import {
  MAX_ACTIVITY_SET_NAME_LENGTH,
  loadoutClassType,
  type ActivitySet,
} from "@/lib/loadouts/activity-sets";
import { loadoutSubclass } from "@/lib/loadouts/subclass";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { ArmorThumb } from "@/components/armor-thumb";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { Emblem } from "@/components/loadouts/ingame-save-dialog";
import { EmptySlotIcon, LOADOUT_SLOT_CLASS } from "@/components/loadouts/loadout-weapons-editor";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A saved loadout's icon in the picker: its subclass, else its exotic armor. */
function loadoutIcon(saved: SavedLoadout, manifest: Manifest): string | undefined {
  const hash = loadoutSubclass(saved.loadout)?.hash ?? saved.loadout.parameters.exoticArmorHash;
  return manifest.def("DestinyInventoryItemDefinition", hash)?.displayProperties.icon;
}

/** One in-game slot: what it's called in the game now, and the saved loadout assigned to it. */
function SlotAssignment({
  slot,
  identifiers,
  options,
  assigned,
  manifest,
  onAssign,
}: {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  /** The saved loadouts this character can wear. */
  options: readonly SavedLoadout[];
  /** The assigned loadout's id; it may since have been deleted. */
  assigned: string | undefined;
  manifest: Manifest;
  onAssign: (loadoutId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pick = assigned ? options.find((l) => l.id === assigned) : undefined;
  const slotName = slot.empty
    ? "Empty"
    : (identifiers.names.find((n) => n.hash === slot.nameHash)?.name ?? "Saved");
  const label = `${slot.index + 1} ${slotName}`;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((l) => l.loadout.name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <div className="relative min-w-0">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          aria-label={`Slot ${label}: ${pick ? pick.loadout.name : assigned ? "a deleted loadout" : "not assigned"}`}
          data-assigned={assigned ? "" : undefined}
          // Stacked like the game's loadout grid: emblem on top, names under it. An
          // assigned slot is filled in so the set's picks stand out from the rest.
          className={cn(
            LOADOUT_SLOT_CLASS,
            "flex-col justify-start gap-1.5 px-1.5 text-center",
            "data-[assigned]:border-foreground/30 data-[assigned]:bg-foreground/12 data-[assigned]:[--tick-alpha:70%]",
          )}
        >
          {slot.empty ? (
            <EmptySlotIcon />
          ) : (
            <span aria-hidden className="relative size-12 shrink-0 overflow-hidden">
              <Emblem
                identifiers={identifiers}
                iconHash={slot.iconHash}
                colorHash={slot.colorHash}
                size={48}
              />
            </span>
          )}
          <span className="flex w-full min-w-0 flex-col">
            <span className="d2-label truncate text-[10px] leading-4">{label}</span>
            <span
              className={cn(
                "truncate text-sm leading-5",
                !assigned && "text-muted-foreground",
                assigned && !pick && "text-warning",
              )}
            >
              {pick ? pick.loadout.name : assigned ? "Deleted loadout" : "Assign loadout"}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-72 gap-2 p-2">
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
            aria-label={`Loadouts for slot ${slot.index + 1}`}
            className="d2-scroll flex max-h-80 flex-col overflow-y-auto overscroll-contain"
          >
            {shown.map((saved) => {
              const selected = saved.id === assigned;
              return (
                <button
                  key={saved.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onAssign(saved.id);
                    setOpen(false);
                    setQuery("");
                  }}
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
        </PopoverContent>
      </Popover>
      {assigned && (
        <TooltipLabel label={`Clear slot ${slot.index + 1}`}>
          <button
            type="button"
            aria-label={`Clear slot ${slot.index + 1}`}
            onClick={() => onAssign(undefined)}
            className="text-muted-foreground hover:text-foreground absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
          </button>
        </TooltipLabel>
      )}
    </div>
  );
}

/**
 * Create or edit an activity set: a name, a character, and which saved loadout goes
 * into each of that character's in-game slots. Saving the set changes nothing in the
 * game — running it does (see runActivitySet).
 */
export function ActivitySetEditor({
  open,
  onOpenChange,
  initial,
  characters,
  loadouts,
  pieceMap,
  manifest,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The set being edited; absent for a new one. */
  initial?: ActivitySet;
  characters: ArmoryCharacter[];
  loadouts: readonly SavedLoadout[];
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  manifest: Manifest;
  onSave: (set: ActivitySet) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [classType, setClassType] = useState(
    () =>
      initial?.classType ??
      [...characters].sort((a, b) => b.dateLastPlayed.localeCompare(a.dateLastPlayed))[0]
        ?.classType ??
      0,
  );
  // slot index → loadout id
  const [assigned, setAssigned] = useState<ReadonlyMap<number, string>>(
    () => new Map(initial?.slots.map((s) => [s.index, s.loadoutId])),
  );

  // The set's own character when it still exists, else the class's most recent one.
  const character =
    (initial?.classType === classType
      ? characters.find((c) => c.id === initial.characterId)
      : undefined) ?? characterForClass(characters, classType);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["ingame-loadouts", character?.id],
    queryFn: () => fetchInGameLoadouts(character!.id),
    enabled: open && !!character,
    staleTime: 60_000,
    retry: false,
  });

  const options = useMemo(
    () =>
      loadouts
        .filter((l) => loadoutClassType(l, pieceMap) === classType)
        .sort((a, b) => a.loadout.name.localeCompare(b.loadout.name)),
    [loadouts, pieceMap, classType],
  );

  // Only slots this character has unlocked can be saved into.
  const slots = data?.slots ?? [];
  const assignments = slots.flatMap((s) => {
    const loadoutId = assigned.get(s.index);
    return loadoutId ? [{ index: s.index, loadoutId }] : [];
  });
  const trimmed = name.trim();
  const canSave = !!character && !!data && trimmed.length > 0 && assignments.length > 0;

  const save = () => {
    if (!canSave || !character) return;
    // Close first, so whatever onSave opens next isn't undone by the close.
    onOpenChange(false);
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: trimmed,
      characterId: character.id,
      classType,
      slots: assignments,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>{initial ? "Edit activity set" : "New activity set"}</DialogTitle>
          <DialogDescription>
            Pick a saved loadout for each in-game slot. Running the set equips each one and
            saves it into its slot; slots you leave unassigned aren&apos;t touched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="d2-label">Name</h3>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_ACTIVITY_SET_NAME_LENGTH}
              placeholder="Raid, Grandmaster, Trials…"
              aria-label="Set name"
              autoFocus={!initial}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="d2-label">Character</h3>
            <ClassEmblemTabs
              characters={characters}
              value={classType}
              onChange={(next) => {
                if (next === classType) return;
                setClassType(next);
                // Loadouts are per class: another character's picks don't carry over.
                setAssigned(new Map());
              }}
            />
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="d2-label">In-game loadouts</h3>
            {!character ? (
              <p className="text-muted-foreground text-sm">
                You don&apos;t have a {CLASS_NAMES[classType] ?? "character"} on this account.
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
            ) : slots.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This character has no in-game loadout slots unlocked yet.
              </p>
            ) : (
              // 4 across, like the game's loadout screen (5 rows when every slot is unlocked).
              <div className="d2-scroll -mx-1 grid max-h-[60vh] grid-cols-4 gap-2 overflow-y-auto px-1">
                {slots.map((slot) => (
                  <SlotAssignment
                    key={slot.index}
                    slot={slot}
                    identifiers={data.identifiers}
                    options={options}
                    assigned={assigned.get(slot.index)}
                    manifest={manifest}
                    onAssign={(loadoutId) =>
                      setAssigned((prev) => {
                        const next = new Map(prev);
                        if (loadoutId) next.set(slot.index, loadoutId);
                        else next.delete(slot.index);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {initial ? "Save changes" : "Create set"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
