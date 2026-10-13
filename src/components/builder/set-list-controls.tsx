"use client";

import { memo, useId, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpDownIcon, FilterIcon } from "@hugeicons/core-free-icons";
import { TooltipLabel } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  hasActiveSetFilters,
  type SetFilters,
  type SetMinOwned,
} from "@/lib/armory/set-filters";
import {
  SET_SORT_OPTIONS,
  setSortLabel,
  type SetSortKey,
} from "@/lib/armory/set-sort";
import { cn } from "@/lib/utils";

/**
 * Figma 17:5663 — the line under the set-bonus search: "<n> Set bonuses" on the
 * left, two 24px icon buttons on the right: sort (ArrowsDownUp) and the list
 * settings (FunnelSimple). The settings button is tinted while any filter is
 * on — i.e. while sets are being hidden — so a narrowed list is never a surprise.
 * A Reset button leads the icons.
 */
export const SetListControls = memo(function SetListControls({
  count,
  sort,
  onSortChange,
  filters,
  onMinOwnedChange,
  planning,
  onReset,
}: {
  count: number;
  sort: SetSortKey;
  onSortChange: (key: SetSortKey) => void;
  filters: SetFilters;
  onMinOwnedChange: (minOwned: SetMinOwned) => void;
  /** Planning what to farm: every set is listed, so the owned-count filter is hidden. */
  planning: boolean;
  onReset: () => void;
}) {
  const activeFilters = hasActiveSetFilters(filters);
  return (
    <div className="flex items-center justify-between gap-2 pl-1">
      <span className="text-sm tabular-nums" aria-live="polite">
        {count} Set {count === 1 ? "bonus" : "bonuses"}
      </span>
      <div className="flex items-center gap-px">
        <Button variant="outline" onClick={onReset} className="mr-2">
          Reset
        </Button>
        <DropdownMenu>
          <TooltipLabel label={`Sort: ${setSortLabel(sort)}`}>
            <DropdownMenuTrigger
              aria-label={`Sort set bonuses (${setSortLabel(sort)})`}
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-foreground/90 hover:text-foreground [&_svg:not([class*='size-'])]:size-4"
                />
              }
            >
              <HugeiconsIcon icon={ArrowUpDownIcon} aria-hidden />
            </DropdownMenuTrigger>
          </TooltipLabel>
          <DropdownMenuContent side="bottom" align="end" className="min-w-48">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(v) => onSortChange(v as SetSortKey)}
            >
              {SET_SORT_OPTIONS.map((opt) => (
                <DropdownMenuRadioItem key={opt.key} value={opt.key}>
                  {opt.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {!planning && (
          <Popover>
            <TooltipLabel label="Armor set list settings">
              <PopoverTrigger
                aria-label="Armor set list settings"
                data-active={activeFilters || undefined}
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "text-foreground/90 hover:text-foreground [&_svg:not([class*='size-'])]:size-4",
                      activeFilters && "text-power hover:text-power",
                    )}
                  />
                }
              >
                <HugeiconsIcon icon={FilterIcon} aria-hidden />
              </PopoverTrigger>
            </TooltipLabel>
            {/* Figma 18:6255 — "Select Menu": titled header, then a checkbox list. */}
            <PopoverContent
              align="end"
              className="w-auto max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
            >
              <PopoverTitle className="text-text-secondary border-b border-foreground/10 px-3 py-2 text-sm font-medium">
                Filter sets
              </PopoverTitle>
              <div className="flex flex-col gap-3 p-3">
                {/* Both boxes read one threshold, so hiding under 4 also ticks "under 2". */}
                <SetListSettingRow
                  checked={filters.minOwned >= 2}
                  onCheckedChange={(checked) => onMinOwnedChange(checked ? 2 : 0)}
                >
                  Hide armor sets I have less than 2 pieces for
                </SetListSettingRow>
                <SetListSettingRow
                  checked={filters.minOwned >= 4}
                  onCheckedChange={(checked) => onMinOwnedChange(checked ? 4 : 2)}
                >
                  Hide armor sets I have less than 4 pieces for
                </SetListSettingRow>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
});

function SetListSettingRow({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label
        htmlFor={id}
        className="min-w-0 cursor-pointer text-sm leading-5 sm:whitespace-nowrap"
      >
        {children}
      </label>
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
