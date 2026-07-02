"use client";

import { useState } from "react";
import { CaretDown, MagnifyingGlass, PushPin } from "@phosphor-icons/react";
import { partitionByPin, type FilterOption } from "@/lib/armor-table/pinned";
import {
  field3dFocusVisibleClasses,
  field3dInteractiveClasses,
  field3dSurfaceClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const MAX_SUMMARY_LABELS = 2;

/** Trigger text: `allLabel` when nothing is selected, else "A, B +n". */
export function selectionSummary<V>(
  selected: readonly V[],
  options: readonly FilterOption<V>[],
  allLabel: string,
) {
  if (selected.length === 0) {
    return <span className="text-muted-foreground">{allLabel}</span>;
  }
  const labels = selected.map(
    (v) => options.find((o) => Object.is(o.value, v))?.label ?? String(v),
  );
  const shown = labels.slice(0, MAX_SUMMARY_LABELS).join(", ");
  return labels.length > MAX_SUMMARY_LABELS
    ? `${shown} +${labels.length - MAX_SUMMARY_LABELS}`
    : shown;
}

export const filterMultiselectTriggerClasses = cn(
  "flex h-8 items-center justify-between gap-1.5 rounded-[6px] border border-transparent bg-clip-padding py-2 pr-2 pl-2.5 text-sm whitespace-nowrap outline-none select-none",
  field3dSurfaceClasses,
  field3dInteractiveClasses,
  field3dFocusVisibleClasses,
  "data-active:after:border-brand/60 data-active:after:bg-brand/10 data-active:hover:after:bg-brand/15",
);

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
      <label
        key={String(opt.value)}
        className="group/option hover:bg-accent flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-sm"
      >
        <Checkbox
          checked={value.includes(opt.value)}
          onCheckedChange={() => toggle(opt.value)}
        />
        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
        {pinnable && onTogglePin && (
          <button
            type="button"
            aria-label={isPinned ? `Unpin ${opt.label}` : `Pin ${opt.label}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin(opt.value);
            }}
            className={cn(
              "shrink-0 transition-opacity focus-visible:opacity-100",
              isPinned
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground opacity-0 group-hover/option:opacity-100",
            )}
          >
            <PushPin
              weight={isPinned ? "fill" : "duotone"}
              className="size-3.5"
              aria-hidden
            />
          </button>
        )}
      </label>
    );
  };

  return (
    <>
      {searchable && (
        <div className="border-border/50 border-b p-2">
          <div className="relative">
            <MagnifyingGlass
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search…"
              aria-label={`Search ${allLabel.toLowerCase()}`}
              className="pl-6"
            />
          </div>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto p-1">
        {partition.pinned.length > 0 && (
          <>
            <div className="text-muted-foreground px-1.5 py-1 text-xs">
              Pinned
            </div>
            {partition.pinned.map(renderOption)}
            <div className="bg-border my-1 h-px" aria-hidden />
          </>
        )}
        {partition.rest.map(renderOption)}
        {partition.pinned.length === 0 && partition.rest.length === 0 && (
          <p className="text-muted-foreground px-1.5 py-2 text-center text-xs">
            No matches.
          </p>
        )}
      </div>
      <div className="border-border/50 flex items-center justify-between gap-2 border-t p-1.5">
        <span className="text-muted-foreground px-1 text-xs tabular-nums">
          {active ? `${value.length} selected` : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          disabled={!active}
          onClick={() => onChange([])}
        >
          Clear
        </Button>
      </div>
    </>
  );
}

/**
 * Checkbox-multiselect filter dropdown (ported UX from armorset-tracker):
 * popover panel with one checkbox row per option, optional in-panel search,
 * optional pin-to-top per option, and a Clear footer. The trigger mirrors
 * SelectTrigger's 3D field treatment and tints brand-blue while any value is
 * selected.
 */
export function FilterMultiselect<V extends string | number>({
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
  const active = value.length > 0;

  return (
    // Uncontrolled open state: Base UI wires trigger association (and with it
    // outside-click/Escape dismissal) itself; we only listen to reset the
    // query on close. Don't cancel() the escape-key close to make Escape
    // clear-then-close — a canceled dismissal wedges Base UI's dismiss state
    // and the panel stops closing at all.
    <Popover
      onOpenChange={(next) => {
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        aria-label={
          active ? `${allLabel} — ${value.length} selected` : allLabel
        }
        data-active={active || undefined}
        className={cn(filterMultiselectTriggerClasses, className)}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectionSummary(value, options, allLabel)}
        </span>
        {active && (
          <Badge
            variant="secondary"
            className="h-4 shrink-0 px-1 text-[10px] tabular-nums"
          >
            {value.length}
          </Badge>
        )}
        <CaretDown
          weight="duotone"
          className="text-muted-foreground pointer-events-none size-4 shrink-0"
          aria-hidden
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
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
      </PopoverContent>
    </Popover>
  );
}
