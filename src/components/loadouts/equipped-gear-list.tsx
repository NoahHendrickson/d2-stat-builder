"use client";

import { memo } from "react";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { ClassGlyph, classGlyphMaxWidth } from "@/components/class-glyph";
import { PowerValue } from "@/components/power-value";
import { TooltipLabel } from "@/components/ui/tooltip";
import { characterLabel } from "@/components/loadouts/use-equipped-gear";
import { cn } from "@/lib/utils";

const GLYPH_WIDTH = classGlyphMaxWidth(16);

/**
 * The top of the loadouts page's name column: an "Equipped gear" row per character,
 * told apart by the class sigil (and Power, when two share a class), last played on top.
 * A click shows that gear as a card above the saved loadouts (a second click hides it).
 * Rows match the loadout names below.
 */
export const EquippedGearList = memo(function EquippedGearList({
  characters,
  blockedLabel,
  openId,
  onOpen,
}: {
  characters: readonly ArmoryCharacter[];
  /** Why the gear can't be shown yet, if it can't. */
  blockedLabel?: string;
  /** The character whose gear card is showing. */
  openId: string | undefined;
  onOpen: (character: ArmoryCharacter) => void;
}) {
  const shown = characters
    .filter((c) => CLASS_NAMES[c.classType] !== undefined)
    .sort((a, b) => b.dateLastPlayed.localeCompare(a.dateLastPlayed));
  if (shown.length === 0) return null;
  return (
    <ul aria-label="Equipped gear" className="flex shrink-0 flex-col">
      {shown.map((character) => {
        const open = character.id === openId;
        const label = characterLabel(character, shown);
        return (
          <li key={character.id}>
            <TooltipLabel label={blockedLabel} disabled={!!blockedLabel}>
              <button
                type="button"
                aria-label={`Equipped gear, ${label}`}
                aria-pressed={open}
                disabled={!!blockedLabel}
                onClick={() => onOpen(character)}
                className={cn(
                  "normal:rounded-[8px] focus-visible:ring-outline-strong d2-hover-ring flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm outline-none transition-[color,background-color,outline-offset] focus-visible:ring-1",
                  blockedLabel
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
                {label !== CLASS_NAMES[character.classType] && (
                  <PowerValue value={character.light} size="xs" className="shrink-0" />
                )}
              </button>
            </TooltipLabel>
          </li>
        );
      })}
    </ul>
  );
});
