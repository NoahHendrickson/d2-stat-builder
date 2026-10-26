"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterMailIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FilterMultiselectPanel,
  selectionSummaryText,
} from "@/components/armor-table/filter-multiselect";
import type { FilterOption } from "@/lib/armor-table/pinned";

/**
 * A column header's filter button: the same checkbox list as the toolbar filter for
 * this column, on the same state, so either one changes both. The button is always
 * shown, dim until hovered (on a narrow table, only while the column is hovered); a
 * filter in effect shows it at full brightness.
 */
export function ColumnFilterMenu<V extends string | number>({
  label,
  allLabel,
  options,
  value,
  onChange,
  hovered,
  searchable = false,
  pinnable = false,
  pinned,
  onTogglePin,
}: {
  label: string;
  allLabel: string;
  options: FilterOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  /** The pointer is somewhere in this column. */
  hovered: boolean;
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const active = value.length > 0;
  const summary = selectionSummaryText(value, options);
  const title = summary ? `Filter ${label}: ${summary}` : `Filter ${label}`;

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <TooltipLabel label={title}>
        <DropdownMenuTrigger
          aria-label={title}
          className={cn(
            "group/filter -my-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-none normal:rounded-[4px] outline-none transition-[background-color,outline-offset]",
            // The outlined buttons' hover: a fill plus the ring standing off the button.
            "d2-hover-ring hover:bg-foreground/6 data-popup-open:bg-foreground/6 focus-visible:ring-1 focus-visible:ring-outline-strong",
            // A table too narrow for every header button (columns under ~127px, so
            // "Archetype" would truncate) keeps this one out of the way until needed.
            !(hovered || active || open) && "@max-[81.5rem]/armor:hidden",
          )}
        >
          <HugeiconsIcon
            icon={FilterMailIcon}
            strokeWidth={2}
            className={cn(
              "size-4 transition-opacity",
              // Same steps as the sort arrow: dim, brighter in the column, full on hover.
              active
                ? "text-foreground"
                : cn(
                    hovered ? "opacity-60" : "opacity-40",
                    "group-hover/filter:text-foreground group-hover/filter:opacity-100 group-data-popup-open/filter:text-foreground group-data-popup-open/filter:opacity-100 group-focus-visible/filter:opacity-100",
                  ),
            )}
            aria-hidden
          />
        </DropdownMenuTrigger>
      </TooltipLabel>
      <DropdownMenuContent align="start" className={searchable ? "w-64" : "w-52"}>
        <FilterMultiselectPanel
          allLabel={allLabel}
          options={options}
          value={value}
          onChange={onChange}
          query={query}
          onQueryChange={setQuery}
          searchable={searchable}
          pinnable={pinnable}
          pinned={pinned}
          onTogglePin={onTogglePin}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
