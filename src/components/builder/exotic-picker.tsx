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
 * Inventory cells: 44px squares in a tight grid. Unselected cells sit dimmed
 * and come up on hover with the white outline; the selected one keeps the
 * outline + glow. These tiles are exotic identities, not inventory instances,
 * so they never get the masterwork gold frame.
 */
const tileBase =
  "group/tile relative size-11 shrink-0 overflow-hidden rounded-none outline-none transition-[opacity,box-shadow,filter] focus-visible:d2-tile-selected";

const tileInactive =
  "opacity-60 saturate-[0.8] hover:opacity-100 hover:saturate-100 hover:d2-tile-selected";

const tileSelected = "d2-tile-selected opacity-100";

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
                    gearTier={exotic.isTier5 ? 5 : undefined}
                  />
                ) : (
                  <span className="flex size-full items-center justify-center bg-exotic/20 text-xs text-exotic-line">
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
          <span className="text-exotic-line font-medium">{options[selected]?.name}</span>.{" "}
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
