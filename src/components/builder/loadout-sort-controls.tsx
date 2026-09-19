"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOADOUT_SORT_OPTIONS,
  loadoutSortLabel,
  type LoadoutSortState,
} from "@/lib/builder/sort-loadouts";
import { cn } from "@/lib/utils";

/**
 * Figma 17:6201 "Select Trigger": a flat, input-bordered "Sort: <key> <direction>"
 * trigger. Each option in the menu has up/down arrows to set key + direction.
 */
export function LoadoutSortControls({
  sort,
  onChange,
}: {
  sort: LoadoutSortState;
  onChange: (next: LoadoutSortState) => void;
}) {
  const DirectionIcon = sort.asc ? ArrowUp : ArrowDown;
  const directionLabel = sort.asc ? "Low to high" : "High to low";
  const triggerLabel = loadoutSortLabel(sort.key);

  return (
    <DropdownMenu>
      <TooltipLabel label={`Sort by ${triggerLabel}, ${directionLabel}`}>
        <DropdownMenuTrigger
          aria-label={`Sort by ${triggerLabel}, ${directionLabel}`}
          className="inline-flex h-8 w-fit shrink-0 cursor-pointer d2-line items-center gap-1.5 rounded-none bg-lifted pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none hover:[--line-alpha:1.6] focus-visible:[--line-alpha:2.6] data-popup-open:[--line-alpha:2.6]"
        >
          <span className="text-muted-foreground">Sort:</span>
          <span className="truncate">{triggerLabel}</span>
          <DirectionIcon className="size-4 shrink-0" aria-hidden />
        </DropdownMenuTrigger>
      </TooltipLabel>
      <DropdownMenuContent
        side="bottom"
        align="end"
        className="w-auto min-w-40 p-1"
      >
        {LOADOUT_SORT_OPTIONS.map((opt) => {
          const active = sort.key === opt.key;
          return (
            <div
              key={opt.key}
              className="flex items-center gap-0.5 rounded-[4px] px-1 py-0.5"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate px-1.5 text-sm",
                  active && "font-medium",
                )}
              >
                {opt.label}
              </span>
              <TooltipLabel label={`Sort by ${opt.label}, low to high`}>
                <DropdownMenuItem
                  label={`${opt.label} low to high`}
                  aria-label={`Sort by ${opt.label}, low to high`}
                  aria-checked={active && sort.asc}
                  className="size-7 justify-center gap-0 p-0"
                  onClick={() => onChange({ key: opt.key, asc: true })}
                >
                  <ArrowUp
                    weight="bold"
                    className={cn(
                      "size-4",
                      active && sort.asc
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                </DropdownMenuItem>
              </TooltipLabel>
              <TooltipLabel label={`Sort by ${opt.label}, high to low`}>
                <DropdownMenuItem
                  label={`${opt.label} high to low`}
                  aria-label={`Sort by ${opt.label}, high to low`}
                  aria-checked={active && !sort.asc}
                  className="size-7 justify-center gap-0 p-0"
                  onClick={() => onChange({ key: opt.key, asc: false })}
                >
                  <ArrowDown
                    weight="bold"
                    className={cn(
                      "size-4",
                      active && !sort.asc
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                </DropdownMenuItem>
              </TooltipLabel>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
