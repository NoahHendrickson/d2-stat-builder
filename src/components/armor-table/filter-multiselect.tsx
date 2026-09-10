"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, PushPin, X } from "@phosphor-icons/react";
import { partitionByPin, type FilterOption } from "@/lib/armor-table/pinned";
import {
  fieldControlInnerTriggerClasses,
  fieldFilterControlShellClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** "Warlock" for one selection, "Gunner +2 more" for several, null when empty. */
export function selectionSummaryText<V>(
  selected: readonly V[],
  options: readonly FilterOption<V>[],
): string | null {
  if (selected.length === 0) return null;
  const first =
    options.find((o) => Object.is(o.value, selected[0]))?.label ??
    String(selected[0]);
  return selected.length > 1 ? `${first} +${selected.length - 1} more` : first;
}

/** Trigger text: muted `allLabel` when nothing is selected, else the summary. */
export function selectionSummary<V>(
  selected: readonly V[],
  options: readonly FilterOption<V>[],
  allLabel: string,
) {
  return (
    selectionSummaryText(selected, options) ?? (
      <span className="text-muted-foreground">{allLabel}</span>
    )
  );
}

export const filterMultiselectActiveBadgeClasses =
  "h-4 shrink-0 border-transparent bg-emphatic px-1 text-[10px] text-emphatic-foreground tabular-nums";

type FilterMultiselectPanelProps<V extends string | number> = {
  allLabel: string;
  options: FilterOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
};

/** Checkbox list body shared by FilterMultiselect and FilterCascadeMenu submenus. */
export function FilterMultiselectPanel<V extends string | number>({
  allLabel,
  options,
  value,
  onChange,
  query,
  onQueryChange,
  searchable = false,
  pinnable = false,
  pinned = [],
  onTogglePin,
}: FilterMultiselectPanelProps<V>) {
  const active = value.length > 0;
  const partition = partitionByPin(options, pinnable ? pinned : [], query);

  const toggle = (v: V) =>
    onChange(
      value.includes(v) ? value.filter((x) => !Object.is(x, v)) : [...value, v],
    );

  const renderOption = (opt: FilterOption<V>) => {
    const isPinned = pinned.includes(opt.value);
    return (
      <DropdownMenuCheckboxItem
        key={String(opt.value)}
        indicator="start"
        closeOnClick={false}
        checked={value.includes(opt.value)}
        onCheckedChange={() => toggle(opt.value)}
      >
        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
        {pinnable && onTogglePin && (
          <TooltipLabel
            label={isPinned ? `Unpin ${opt.label}` : `Pin ${opt.label}`}
          >
            <button
              type="button"
              aria-label={isPinned ? `Unpin ${opt.label}` : `Pin ${opt.label}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTogglePin(opt.value);
              }}
              className={cn(
                "relative flex size-7 shrink-0 items-center justify-center rounded-[4px] transition-opacity outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50",
                isPinned
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground opacity-0 group-hover/dropdown-menu-checkbox-item:opacity-100",
              )}
            >
              <PushPin
                weight={isPinned ? "fill" : "duotone"}
                className="size-3.5"
                aria-hidden
              />
            </button>
          </TooltipLabel>
        )}
      </DropdownMenuCheckboxItem>
    );
  };

  return (
    <>
      {searchable && (
        <div
          className="p-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <MagnifyingGlass
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search…"
              aria-label={`Search ${allLabel.toLowerCase()}`}
              className="pl-8"
            />
          </div>
        </div>
      )}
      {partition.pinned.length > 0 && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Pinned</DropdownMenuLabel>
            {partition.pinned.map(renderOption)}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      {partition.rest.map(renderOption)}
      {partition.pinned.length === 0 && partition.rest.length === 0 && (
        <p className="text-muted-foreground px-1.5 py-2 text-center text-xs">
          No matches.
        </p>
      )}
      {active && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem closeOnClick={false} onClick={() => onChange([])}>
            Clear
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/**
 * Checkbox-multiselect filter dropdown. Uses the same DropdownMenu chrome and
 * checkbox items as the sidebar loadout filters.
 */
export function FilterMultiselect<V extends string | number>({
  label,
  allLabel,
  options,
  value,
  onChange,
  searchable = false,
  pinnable = false,
  pinned = [],
  onTogglePin,
  className,
}: {
  label: string;
  allLabel: string;
  options: FilterOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = value.length > 0;
  const summaryText = selectionSummaryText(value, options);

  return (
    <div className={cn("relative min-w-40 flex-1 overflow-visible", className)}>
      <DropdownMenu
        modal={false}
        onOpenChange={(next) => {
          if (!next) setQuery("");
        }}
      >
        <div
          className={cn(fieldFilterControlShellClasses, "box-border w-full")}
          data-active={active || undefined}
        >
          <TooltipLabel
            label={
              active
                ? `${label}: ${summaryText} — ${value.length} selected`
                : `${label}: ${allLabel}`
            }
          >
            <DropdownMenuTrigger
              ref={triggerRef}
              aria-label={
                active
                  ? `${label}: ${summaryText} — ${value.length} selected`
                  : `${label}: ${allLabel}`
              }
              className={fieldControlInnerTriggerClasses}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {selectionSummary(value, options, allLabel)}
              </span>
              {active ? (
                <span className="size-4 shrink-0" aria-hidden />
              ) : (
                <CaretDown
                  weight="duotone"
                  className="text-muted-foreground pointer-events-none size-4 shrink-0"
                  aria-hidden
                />
              )}
            </DropdownMenuTrigger>
          </TooltipLabel>
        </div>
        {active && (
          <TooltipLabel label={`Clear ${label.toLowerCase()} filter`}>
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()} filter`}
              onClick={() => {
                onChange([]);
                triggerRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] outline-none focus-visible:ring-3"
            >
              <X weight="bold" className="size-3.5" aria-hidden />
            </button>
          </TooltipLabel>
        )}
        <DropdownMenuContent align="start" className="w-64">
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
    </div>
  );
}
