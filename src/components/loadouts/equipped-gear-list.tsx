"use client";

import { memo } from "react";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { ClassGlyph, classGlyphMaxWidth } from "@/components/class-glyph";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const GLYPH_WIDTH = classGlyphMaxWidth(16);

/**
 * The top of the loadouts page's name column: an "Equipped gear" row per character,
 * told apart by the class sigil. A click shows that gear as a card above the saved
 * loadouts (a second click hides it). Rows match the loadout names below.
 */
export const EquippedGearList = memo(function EquippedGearList({
  characters,
  disabled,
  openId,
  onOpen,
}: {
  characters: readonly ArmoryCharacter[];
  /** The armory is last visit's copy, so its gear may not be what's on now. */
  disabled: boolean;
  /** The character whose gear card is showing. */
  openId: string | undefined;
  onOpen: (character: ArmoryCharacter) => void;
}) {
  const shown = characters.filter((c) => CLASS_NAMES[c.classType] !== undefined);
  if (shown.length === 0) return null;
  return (
    <ul aria-label="Equipped gear" className="flex shrink-0 flex-col">
      {shown.map((character) => {
        const open = character.id === openId;
        return (
          <li key={character.id}>
            <TooltipLabel label={disabled ? "Waiting for your live profile" : undefined} disabled={disabled}>
              <button
                type="button"
                aria-label={`${CLASS_NAMES[character.classType]}'s equipped gear`}
                aria-pressed={open}
                disabled={disabled}
                onClick={() => onOpen(character)}
                className={cn(
                  "normal:rounded-[8px] focus-visible:ring-outline-strong d2-hover-ring flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm outline-none transition-[color,background-color,outline-offset] focus-visible:ring-1",
                  disabled
                    ? "text-muted-foreground cursor-not-allowed opacity-50"
                    : open
                      ? "bg-foreground/8 normal:bg-foreground/6 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <span aria-hidden className="flex shrink-0 justify-center" style={{ width: GLYPH_WIDTH }}>
                  <ClassGlyph classType={character.classType} />
                </span>
                <span className="min-w-0 flex-1 truncate">Equipped gear</span>
              </button>
            </TooltipLabel>
          </li>
        );
      })}
    </ul>
  );
});
