"use client";

import { memo, useId, type ReactNode } from "react";
import { ArrowsDownUp, FunnelSimple } from "@phosphor-icons/react";
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
  hasCustomSetFilters,
  type SetFilters,
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
 * settings (FunnelSimple). The settings button is tinted while a filter is
 * off its default so a narrowed list is never a surprise.
 */
export const SetListControls = memo(function SetListControls({
  count,
  sort,
  onSortChange,
  filters,
  onFilterChange,
}: {
  count: number;
  sort: SetSortKey;
  onSortChange: (key: SetSortKey) => void;
  filters: SetFilters;
  onFilterChange: (key: keyof SetFilters, value: boolean) => void;
}) {
  const customFilters = hasCustomSetFilters(filters);
  return (
    <div className="flex items-center justify-between gap-2 pl-1">
      <span className="text-sm tabular-nums" aria-live="polite">
        {count} Set {count === 1 ? "bonus" : "bonuses"}
      </span>
      <div className="flex items-center gap-px">
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
              <ArrowsDownUp aria-hidden />
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

        <Popover>
          <TooltipLabel label="Armor set list settings">
            <PopoverTrigger
              aria-label="Armor set list settings"
              data-active={customFilters || undefined}
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "text-foreground/90 hover:text-foreground [&_svg:not([class*='size-'])]:size-4",
                    customFilters && "text-emphatic hover:text-emphatic",
                  )}
                />
              }
            >
              <FunnelSimple aria-hidden />
            </PopoverTrigger>
          </TooltipLabel>
          {/* Figma 18:6255 — "Select Menu": titled header, then a checkbox list. */}
          <PopoverContent
            align="end"
            className="w-58 gap-0 overflow-hidden p-0"
          >
            <PopoverTitle className="border-border text-text-secondary border-b px-3 py-2 text-sm font-medium">
              Hide sets
            </PopoverTitle>
            <div className="flex flex-col gap-3 p-3">
              <SetListSettingRow
                checked={filters.hideZero}
                onCheckedChange={(checked) =>
                  onFilterChange("hideZero", checked)
                }
              >
                Hide sets I have 0 pieces of
              </SetListSettingRow>
              <SetListSettingRow
                checked={filters.hideLessThan2}
                onCheckedChange={(checked) =>
                  onFilterChange("hideLessThan2", checked)
                }
              >
                Hide sets I have less than 2 pieces of
              </SetListSettingRow>
            </div>
          </PopoverContent>
        </Popover>
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
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-5">
        {children}
      </label>
    </div>
  );
}
