"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import {
  slotAppearanceInSet,
  type InGameLoadoutIdentifiers,
  type InGameLoadoutSlot,
  type SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import { Emblem } from "@/components/loadouts/ingame-save-dialog";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const inGameSlotName = (slot: InGameLoadoutSlot, identifiers: InGameLoadoutIdentifiers) =>
  slot.empty ? "Empty" : (identifiers.names.find((n) => n.hash === slot.nameHash)?.name ?? "Saved");

/**
 * A character's in-game slots as the game lays them out: numbered emblems four across,
 * five rows when every slot is unlocked. Names are on hover. Clicking one selects it. With
 * `assignments` the grid shows an activity set: slots it fills have an emblem and the rest
 * are empty placeholders, so it's plain what applying it won't touch. A slot whose loadout
 * has been deleted (null) has a warning-coloured number. `peek` shows what the game holds
 * in the slots the set leaves alone, dimmed so they still read as outside the set. With
 * `onToggleSlot`, hovering a slot offers a minus to take it out of the set, or a plus to
 * put what the game holds there into it.
 */
export function InGameSlotGrid({
  slots,
  identifiers,
  selectedIndex,
  onSelect,
  assignments,
  labelsFor,
  peek = false,
  onToggleSlot,
}: {
  slots: readonly InGameLoadoutSlot[];
  identifiers: InGameLoadoutIdentifiers;
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
  /** Slot index → assigned loadout's name. Absent when showing the game's own slots. */
  assignments?: ReadonlyMap<number, string | null>;
  /** The name, icon and colour the set chose for a slot, if any. */
  labelsFor?: (index: number) => SlotIdentifiers | undefined;
  peek?: boolean;
  /** Add or remove a slot; absent while the set can't be edited. */
  onToggleSlot?: (slot: InGameLoadoutSlot) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="In-game slots"
      className="grid w-full grid-cols-4 gap-1.5"
    >
      {slots.map((slot) => {
        const checked = slot.index === selectedIndex;
        const name = inGameSlotName(slot, identifiers);
        const assigned = assignments?.get(slot.index);
        const inSet = assigned !== undefined;
        const shown = assignments
          ? slotAppearanceInSet(slot, inSet, identifiers, labelsFor?.(slot.index))
          : slot;
        const peeking = !!assignments && peek && !inSet && !slot.empty;
        const notInSet = peeking
          ? `${name} is in-game. Not in this set, so it won't change`
          : "Not in this set, so it won't change";
        const tooltip = assignments ? assigned ?? (inSet ? "Deleted loadout" : notInSet) : name;
        const description = assignments
          ? `: ${assigned ?? (inSet ? "a deleted loadout" : "not assigned")}`
          : "";
        // Nothing to add from a slot that's empty in the game; clicking it picks a loadout.
        const canToggle = !!onToggleSlot && (inSet || !slot.empty);
        return (
          <div key={slot.index} className="group/tile relative min-w-0">
          <TooltipLabel label={tooltip}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`Slot ${slot.index + 1}, ${name}${description}`}
              onClick={() => onSelect(slot.index)}
              className="group flex w-full min-w-0 cursor-pointer outline-none"
            >
              <span
                aria-hidden
                className={cn(
                  "d2-hover-ring relative flex aspect-square w-full items-center justify-center overflow-hidden transition-shadow group-focus-visible:ring-1 group-focus-visible:ring-outline-strong",
                  shown.empty ? "d2-brackets bg-black/25" : "bg-foreground/6",
                  checked && "d2-tile-selected",
                )}
              >
                {!shown.empty && (
                  <Emblem
                    identifiers={identifiers}
                    iconHash={shown.iconHash}
                    colorHash={shown.colorHash}
                    size={72}
                  />
                )}
                {peeking && (
                  <>
                    <span data-slot-peek className="absolute inset-0 opacity-40">
                      <Emblem
                        identifiers={identifiers}
                        iconHash={slot.iconHash}
                        colorHash={slot.colorHash}
                        size={72}
                      />
                    </span>
                    {/* The emblem covers the tile's own brackets, so they're drawn again above it. */}
                    <span className="d2-brackets absolute inset-0" />
                  </>
                )}
                <span
                  className={cn(
                    "absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center bg-black/50 px-1 text-[11px] leading-none font-medium tabular-nums backdrop-blur-sm",
                    inSet && assigned === null ? "text-warning" : "text-white",
                  )}
                >
                  {slot.index + 1}
                </span>
              </span>
            </button>
          </TooltipLabel>
          {canToggle && (
            <TooltipLabel label={inSet ? "Leave out of this set" : "Add what's in this slot"}>
              <button
                type="button"
                aria-label={`${inSet ? "Exclude" : "Include"} slot ${slot.index + 1}`}
                onClick={() => onToggleSlot(slot)}
                // Always showing on touch screens, which have no hover.
                className="focus-visible:ring-outline-strong absolute top-1 right-1 z-20 flex size-5 cursor-pointer items-center justify-center border border-white/24 bg-black/70 text-white opacity-0 outline-none transition-opacity group-hover/tile:opacity-100 hover:bg-black/90 focus-visible:opacity-100 focus-visible:ring-1 [@media(pointer:coarse)]:opacity-100"
              >
                <HugeiconsIcon icon={inSet ? MinusSignIcon : Add01Icon} strokeWidth={2} className="size-3" aria-hidden />
              </button>
            </TooltipLabel>
          )}
          </div>
        );
      })}
    </div>
  );
}
