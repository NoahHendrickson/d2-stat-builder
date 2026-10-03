"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import {
  defaultIdentifiers,
  type InGameLoadoutIdentifiers,
  type InGameLoadoutSlot,
  type SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import { fetchInGameLoadouts, type InGameSlotChoice } from "@/lib/loadouts/ingame-save";
import { ArmorThumb } from "@/components/armor-thumb";
import { TooltipLabel } from "@/components/ui/tooltip";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SWATCH_CLASS =
  "d2-hover-ring relative shrink-0 overflow-hidden rounded-none outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-outline-strong";

/** A loadout's emblem as the game draws it: the icon over its colour. */
function Emblem({
  identifiers,
  iconHash,
  colorHash,
  size,
}: {
  identifiers: InGameLoadoutIdentifiers;
  iconHash?: number;
  colorHash?: number;
  size: number;
}) {
  const color = identifiers.colors.find((c) => c.hash === colorHash)?.path;
  const icon = identifiers.icons.find((i) => i.hash === iconHash)?.path;
  return (
    <>
      {color && (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${color}`}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full max-w-none object-cover"
          unoptimized
        />
      )}
      {icon && (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${icon}`}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full max-w-none"
          unoptimized
        />
      )}
    </>
  );
}

function SlotPicker({
  slots,
  identifiers,
  selected,
  onSelect,
}: {
  slots: InGameLoadoutSlot[];
  identifiers: InGameLoadoutIdentifiers;
  selected: number | undefined;
  onSelect: (index: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Slot" className="grid grid-cols-4 gap-x-2 gap-y-3">
      {slots.map((slot) => {
        const checked = slot.index === selected;
        const name = slot.empty
          ? "Empty"
          : (identifiers.names.find((n) => n.hash === slot.nameHash)?.name ?? "Saved");
        return (
          <button
            key={slot.index}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`Slot ${slot.index + 1}, ${name}`}
            onClick={() => onSelect(slot.index)}
            className="group flex min-w-0 flex-col items-center gap-1.5 outline-none"
          >
            <span
              aria-hidden
              className={cn(
                "d2-hover-ring bg-foreground/6 text-muted-foreground relative flex size-12 items-center justify-center overflow-hidden text-sm tabular-nums transition-shadow group-focus-visible:ring-1 group-focus-visible:ring-outline-strong",
                checked && "d2-tile-selected",
              )}
            >
              {slot.empty ? (
                slot.index + 1
              ) : (
                <Emblem
                  identifiers={identifiers}
                  iconHash={slot.iconHash}
                  colorHash={slot.colorHash}
                  size={48}
                />
              )}
            </span>
            <span
              className={cn(
                "w-full truncate text-center text-xs leading-4",
                !checked && "text-muted-foreground",
              )}
            >
              {slot.empty ? name : `${slot.index + 1} ${name}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The gear a filled slot holds now — what saving over it will replace. */
function SlotContents({ slot, manifest }: { slot: InGameLoadoutSlot; manifest: Manifest }) {
  return (
    <div role="list" className="flex flex-wrap gap-1.5">
      {slot.items.map((item) => {
        const def = manifest.def("DestinyInventoryItemDefinition", item.itemHash);
        const name = def?.displayProperties.name || "An item you no longer have";
        return (
          <TooltipLabel key={item.itemInstanceId} label={name}>
            <span role="listitem" aria-label={name} tabIndex={0} className="flex outline-none">
              <ArmorThumb
                icon={def?.displayProperties.icon}
                watermark={def?.iconWatermark}
                size={40}
              />
            </span>
          </TooltipLabel>
        );
      })}
    </div>
  );
}

/**
 * Pick which in-game loadout slot a saved loadout goes into, and the name / icon /
 * colour the game shows for it. Confirming equips the loadout and snapshots the slot
 * (see saveLoadoutInGame) — the dialog only collects the choice.
 */
export function InGameSaveDialog({
  open,
  onOpenChange,
  loadoutName,
  character,
  manifest,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadoutName: string;
  /** The character the loadout will be equipped on; its slots are the ones offered. */
  character: ArmoryCharacter;
  /** Names and icons for the gear in the slot being replaced. */
  manifest: Manifest;
  onConfirm: (choice: InGameSlotChoice) => void;
}) {
  // Always refetched: slots change in-game, and the pick decides what gets overwritten.
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["ingame-loadouts", character.id],
    queryFn: () => fetchInGameLoadouts(character.id),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const [slotIndex, setSlotIndex] = useState<number>();
  // The user's own picks; anything not picked follows the selected slot's defaults.
  const [picks, setPicks] = useState<Partial<SlotIdentifiers>>({});

  const slot = data?.slots.find((s) => s.index === slotIndex);
  const defaults = data ? defaultIdentifiers(slot, data.identifiers) : undefined;
  const chosen = defaults ? { ...defaults, ...picks } : undefined;
  const className = CLASS_NAMES[character.classType] ?? "character";
  const replacing = slot && !slot.empty;

  const confirm = () => {
    if (!slot || !chosen) return;
    onConfirm({ loadoutIndex: slot.index, ...chosen });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>Save to in-game loadout</DialogTitle>
          <DialogDescription>
            Equips {loadoutName} on your {className}, then saves everything equipped into the
            slot you pick. Any weapon slot the loadout leaves empty is saved as whatever you have on.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
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
        ) : data.slots.length === 0 || !chosen ? (
          <p className="text-muted-foreground text-sm">
            This character has no in-game loadout slots unlocked yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="d2-label">Slot</h3>
              <SlotPicker
                slots={data.slots}
                identifiers={data.identifiers}
                selected={slotIndex}
                onSelect={(index) => {
                  setSlotIndex(index);
                  setPicks({});
                }}
              />
            </section>

            {replacing && (
              <section className="flex flex-col gap-2">
                <h3 className="d2-label">Replacing</h3>
                <SlotContents slot={slot} manifest={manifest} />
              </section>
            )}

            {slot && (
              <>
                <section className="flex flex-col gap-2">
                  <h3 className="d2-label">Name</h3>
                  <Select
                    items={Object.fromEntries(
                      data.identifiers.names.map((n) => [String(n.hash), n.name]),
                    )}
                    value={String(chosen.nameHash)}
                    onValueChange={(v) =>
                      v != null && setPicks((p) => ({ ...p, nameHash: Number(v) }))
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Name">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {data.identifiers.names.map((n) => (
                        <SelectItem key={n.hash} value={String(n.hash)}>
                          {n.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="d2-label">Icon</h3>
                  <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-2">
                    {data.identifiers.icons.map((icon, i) => {
                      const checked = icon.hash === chosen.iconHash;
                      return (
                        <button
                          key={icon.hash}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={`Icon ${i + 1}`}
                          onClick={() => setPicks((p) => ({ ...p, iconHash: icon.hash }))}
                          className={cn(SWATCH_CLASS, "size-9", checked && "d2-tile-selected")}
                        >
                          <Emblem
                            identifiers={data.identifiers}
                            iconHash={icon.hash}
                            colorHash={chosen.colorHash}
                            size={36}
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="d2-label">Color</h3>
                  <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
                    {data.identifiers.colors.map((color, i) => {
                      const checked = color.hash === chosen.colorHash;
                      return (
                        <button
                          key={color.hash}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={`Color ${i + 1}`}
                          onClick={() => setPicks((p) => ({ ...p, colorHash: color.hash }))}
                          className={cn(SWATCH_CLASS, "size-6", checked && "d2-tile-selected")}
                        >
                          <Emblem identifiers={data.identifiers} colorHash={color.hash} size={24} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!slot || !chosen}>
            {replacing ? "Equip and replace" : "Equip and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
