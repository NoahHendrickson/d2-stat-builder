"use client";

import { memo } from "react";
import { TooltipLabel } from "@/components/ui/tooltip";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Button } from "@/components/ui/button";

export interface ExoticOption {
  name: string;
  /** All item hashes for this exotic (same exotic can exist as Armor 2.0 + 3.0). */
  hashes: number[];
  /** Relative Bungie icon path, if any. */
  icon?: string;
}

/**
 * Figma 17:5655 — 40px tiles in a tight 8px grid. Unselected tiles sit at 65%
 * opacity and come up on hover; the selected one is full-strength with a
 * background-coloured inset border and an emphatic ring + glow
 * (0 0 0 2px + 0 0 8px 1px).
 */
const tileBase =
  "group/tile relative size-10 shrink-0 overflow-hidden rounded-[2px] border-2 border-transparent outline-none transition-[opacity,box-shadow,border-color] focus-visible:ring-3 focus-visible:ring-ring/50";

const tileInactive = "opacity-65 hover:opacity-100";

const tileSelected =
  "border-background opacity-100 shadow-[0_0_0_2px_var(--emphatic),0_0_8px_1px_var(--emphatic)]";

/**
 * Thumbnail grid for choosing which exotic to build around. Click a tile to require
 * that exotic, click it again to clear. Nothing selected = the optimizer decides.
 */
export const ExoticPicker = memo(function ExoticPicker({
  options,
  selected,
  onSelect,
}: {
  options: ExoticOption[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No exotic armor found for this class.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 p-0.5">
        {options.map((exotic, index) => {
          const active = selected === index;
          return (
            <TooltipLabel label={exotic.name} key={exotic.name}>
              <button
                type="button"
                aria-label={exotic.name}
                aria-pressed={active}
                onClick={() => onSelect(active ? null : index)}
                className={cn(tileBase, active ? tileSelected : tileInactive)}
              >
                {exotic.icon ? (
                  <Image
                    src={`${BUNGIE_IMAGE_BASE}${exotic.icon}`}
                    alt={exotic.name}
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <span className="bg-card text-muted-foreground flex size-full items-center justify-center text-xs">
                    {exotic.name.slice(0, 2)}
                  </span>
                )}
              </button>
            </TooltipLabel>
          );
        })}
      </div>
      {selected !== null && (
        <p className="text-muted-foreground text-xs">
          Requiring{" "}
          <span className="text-foreground">{options[selected]?.name}</span>.{" "}
          <Button
            variant="link"
            className="h-auto p-0 text-xs font-normal text-inherit underline"
            onClick={() => onSelect(null)}
          >
            Clear
          </Button>
        </p>
      )}
    </div>
  );
});
