"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { characterForClass } from "@/lib/armory/character-for-class";
import { ARMOR_BUCKETS, ARMOR_SLOTS, CLASS_NAMES } from "@/lib/armory/stats";
import { WEAPON_BUCKETS, WEAPON_SLOTS, type LoadoutWeapon } from "@/lib/armory/weapons";
import type { InGameLoadoutIdentifiers, InGameLoadoutSlot } from "@/lib/bungie/ingame-loadouts";
import { subclassFromItemHash } from "@/lib/dim/subclasses";
import type { Manifest } from "@/lib/manifest/load";
import { fetchInGameLoadouts } from "@/lib/loadouts/ingame-save";
import { inGameImportName, inGameSlotToLoadout } from "@/lib/loadouts/ingame-import";
import { MAX_NAME_LENGTH, type SavedLoadoutData } from "@/lib/loadouts/types";
import { ArmorThumb } from "@/components/armor-thumb";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { Emblem } from "@/components/loadouts/ingame-save-dialog";
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
import { Input } from "@/components/ui/input";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Subclass, then weapons, then armor, each in slot order — the way loadout cards read. */
function previewOrder(itemHash: number, manifest: Manifest): number {
  if (subclassFromItemHash(itemHash)) return 0;
  const bucket = manifest.def("DestinyInventoryItemDefinition", itemHash)?.inventory?.bucketTypeHash ?? 0;
  const weapon = WEAPON_BUCKETS[bucket];
  if (weapon) return 1 + WEAPON_SLOTS.indexOf(weapon);
  const armor = ARMOR_BUCKETS[bucket as keyof typeof ARMOR_BUCKETS];
  if (armor) return 1 + WEAPON_SLOTS.length + ARMOR_SLOTS.indexOf(armor);
  return 99;
}

/** The slot's gear as small thumbnails, named on hover. */
function SlotPreview({ slot, manifest }: { slot: InGameLoadoutSlot; manifest: Manifest }) {
  const items = slot.items
    .flatMap((item) => (item.itemHash === undefined ? [] : [{ ...item, itemHash: item.itemHash }]))
    .sort((a, b) => previewOrder(a.itemHash, manifest) - previewOrder(b.itemHash, manifest));
  const gone = slot.items.length - items.length;
  return (
    <div role="list" aria-label="Gear in this loadout" className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const def = manifest.def("DestinyInventoryItemDefinition", item.itemHash);
        const name = def?.displayProperties.name || "Unknown item";
        return (
          <TooltipLabel key={item.itemInstanceId} label={name}>
            <span role="listitem" aria-label={name} tabIndex={0} className="flex outline-none">
              <ArmorThumb icon={def?.displayProperties.icon} watermark={def?.iconWatermark} size={32} />
            </span>
          </TooltipLabel>
        );
      })}
      {gone > 0 && (
        <span className="text-muted-foreground pl-1 text-xs">
          {gone} {gone === 1 ? "item" : "items"} no longer owned
        </span>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  identifiers,
  manifest,
  picked,
  name,
  onPick,
  onName,
}: {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  manifest: Manifest;
  picked: boolean;
  name: string;
  onPick: (picked: boolean) => void;
  onName: (name: string) => void;
}) {
  const inGameName = inGameImportName(slot, identifiers.names);
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 p-2 transition-colors",
        picked ? "bg-foreground/8" : "hover:bg-foreground/4",
      )}
    >
      <label className="flex shrink-0 cursor-pointer items-center gap-3">
        <Checkbox
          size="lg"
          checked={picked}
          onCheckedChange={(checked) => onPick(checked === true)}
          aria-label={`Import slot ${slot.index + 1}, ${inGameName}`}
        />
        <span aria-hidden className="relative size-10 shrink-0 overflow-hidden">
          <Emblem
            identifiers={identifiers}
            iconHash={slot.iconHash}
            colorHash={slot.colorHash}
            size={40}
          />
        </span>
      </label>
      <Input
        value={name}
        onChange={(e) => onName(e.target.value)}
        onFocus={() => !picked && onPick(true)}
        maxLength={MAX_NAME_LENGTH}
        placeholder={inGameName}
        aria-label={`Name for slot ${slot.index + 1}`}
        className="min-w-40 flex-1 basis-40"
      />
      <SlotPreview slot={slot} manifest={manifest} />
    </li>
  );
}

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
  const [classType, setClassType] = useState(
    () =>
      [...characters].sort((a, b) => b.dateLastPlayed.localeCompare(a.dateLastPlayed))[0]
        ?.classType ?? 0,
  );
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  // The player's own names, by slot index; a slot not renamed keeps the in-game name.
  const [names, setNames] = useState<ReadonlyMap<number, string>>(() => new Map());
  const character = characterForClass(characters, classType);

  // Always refetched: the slots are whatever the game holds right now.
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["ingame-loadouts", character?.id],
    queryFn: () => fetchInGameLoadouts(character!.id),
    enabled: open && !!character,
    staleTime: 0,
    retry: false,
  });

  const filled = (data?.slots ?? []).filter((s) => !s.empty);
  const chosen = filled.filter((s) => picked.has(s.index));
  const nameFor = (slot: InGameLoadoutSlot) =>
    names.get(slot.index) ?? (data ? inGameImportName(slot, data.identifiers.names) : "");
  const allPicked = filled.length > 0 && chosen.length === filled.length;

  const setPick = (index: number, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  const confirm = () => {
    if (!data || chosen.length === 0) return;
    const loadouts = chosen.map((slot) =>
      inGameSlotToLoadout({
        slot,
        // A name cleared to nothing falls back to the in-game one.
        name: nameFor(slot).trim() || inGameImportName(slot, data.identifiers.names),
        classType,
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
            Pick the slots to save here. Each keeps its subclass setup, weapons, armor and
            mods. Your in-game loadouts stay as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="d2-label">Character</h3>
            <ClassEmblemTabs
              characters={characters}
              value={classType}
              onChange={(next) => {
                if (next === classType) return;
                setClassType(next);
                // Slot numbers belong to a character: picks and names don't carry over.
                setPicked(new Set());
                setNames(new Map());
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
            ) : filled.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This character has nothing saved in its in-game loadouts yet.
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
                    name={nameFor(slot)}
                    onPick={(on) => setPick(slot.index, on)}
                    onName={(name) =>
                      setNames((prev) => new Map(prev).set(slot.index, name))
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={chosen.length === 0}>
            {chosen.length > 1 ? `Import ${chosen.length} loadouts` : "Import loadout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
