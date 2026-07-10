"use client";

import { ArrowDown, ArrowUp, CaretDown } from "@phosphor-icons/react";
import { Menu } from "@/components/ui/menu";
import {
  LOADOUT_SORT_OPTIONS,
  loadoutSortLabel,
  type LoadoutSortState,
} from "@/lib/builder/sort-loadouts";
import {
  field3dFocusVisibleClasses,
  field3dInteractiveClasses,
  field3dSurfaceClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";

/** Compact sort control: each option has up/down arrows to set key + direction. */
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
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Sort by ${triggerLabel}, ${directionLabel}`}
        className={cn(
          "flex h-7 w-fit min-w-28 cursor-pointer items-center justify-between gap-1.5 rounded-[6px] border border-transparent bg-clip-padding py-2 pr-2 pl-2.5 text-[0.8rem] whitespace-nowrap outline-none select-none",
          field3dSurfaceClasses,
          field3dInteractiveClasses,
          field3dFocusVisibleClasses,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{triggerLabel}</span>
          <DirectionIcon
            weight="bold"
            className="size-4 shrink-0"
            aria-hidden
          />
        </span>
        <CaretDown
          weight="duotone"
          className="text-muted-foreground pointer-events-none size-3.5 shrink-0"
          aria-hidden
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end">
          <Menu.Popup className="min-w-40 p-1">
            {LOADOUT_SORT_OPTIONS.map((opt) => {
              const active = sort.key === opt.key;
              return (
                <div
                  key={opt.key}
                  className="flex items-center gap-0.5 rounded-md px-1 py-0.5"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate px-1.5 text-sm",
                      active && "font-medium",
                    )}
                  >
                    {opt.label}
                  </span>
                  <Menu.Item
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
                          ? "text-brand"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                  </Menu.Item>
                  <Menu.Item
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
                          ? "text-brand"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                  </Menu.Item>
                </div>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
