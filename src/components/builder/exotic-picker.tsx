"use client";

import { memo } from "react";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ArmorThumb } from "@/components/armor-thumb";
import { Button } from "@/components/ui/button";

export interface ExoticOption {
  name: string;
  /** All item hashes for this exotic (same exotic can exist as Armor 2.0 + 3.0). */
  hashes: number[];
  /** Relative Bungie icon path, if any. */
  icon?: string;
  watermark?: string;
  isTier5?: boolean;
}

/**
 * Inventory cells: 44px squares in a tight grid. Armor 3.0 tiles get the
 * gold glow frame; Armor 2.0 / un-tiered ones stay a plain icon. Unselected
 * cells sit dimmed and come up on hover with the white outline; the selected
 * one keeps the outline + glow.
 */
const tileBase =
  "group/tile relative size-10 shrink-0 overflow-hidden rounded-[2px] border-2 border-transparent outline-none transition-[opacity,box-shadow,border-color,filter] classic:focus-visible:ring-3 classic:focus-visible:ring-ring/50 focus-visible:d2-tile-selected d2:size-11 d2:rounded-none d2:border-0";

const tileInactive =
  "opacity-65 hover:opacity-100 hover:d2-tile-selected d2:opacity-60 d2:saturate-[0.8] d2:hover:opacity-100 d2:hover:saturate-100";

const tileSelected =
  "d2-tile-selected border-background opacity-100 classic:shadow-[0_0_0_2px_var(--emphatic),0_0_8px_1px_var(--emphatic)]";

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
                  <ArmorThumb
                    icon={exotic.icon}
                    watermark={exotic.watermark}
                    alt={exotic.name}
                    size={44}
                    exoticFrame
                    isTier5={exotic.isTier5}
                    className="classic:size-full"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center bg-foreground/12 text-xs text-muted-foreground d2:bg-exotic/20 d2:text-exotic-line">
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
          <span className="text-foreground d2:text-exotic-line d2:font-medium">{options[selected]?.name}</span>.{" "}
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
