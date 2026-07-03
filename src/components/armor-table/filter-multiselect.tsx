"use client";

import { useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, PushPin, X } from "@phosphor-icons/react";
import { partitionByPin, type FilterOption } from "@/lib/armor-table/pinned";
import {
  fieldControlInnerTriggerClasses,
  fieldFilterControlShellClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** "Warlock" for one selection, "Gunner +2 more" for several, null when empty. */
export function selectionSummaryText<V>(
  selected: readonly V[],
  options: readonly FilterOption<V>[],
): string | null {
  if (selected.length === 0) return null;
  const first =
    options.find((o) => Object.is(o.value, selected[0]))?.label ??
    String(selected[0]);
  return selected.length > 1
    ? `${first} +${selected.length - 1} more`
    : first;
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
  "h-4 shrink-0 border-transparent bg-brand px-1 text-[10px] text-white tabular-nums";

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
 * SelectTrigger's 3D field treatment and shows a brand-blue border while any
 * value is selected.
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
    <div className={cn("relative w-40 shrink-0 overflow-visible", className)}>
      {/* Uncontrolled open state: Base UI wires trigger association (and with it
          outside-click/Escape dismissal) itself; we only listen to reset the
          query on close. Don't cancel() the escape-key close to make Escape
          clear-then-close — a canceled dismissal wedges Base UI's dismiss state
          and the panel stops closing at all. */}
      <Popover
        onOpenChange={(next) => {
          if (!next) setQuery("");
        }}
      >
        <div
          className={cn(
            fieldFilterControlShellClasses,
            "peer/filter box-border w-full",
          )}
          data-active={active || undefined}
        >
          <PopoverTrigger
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
              // Placeholder for the caret slot; the clear button overlays it
              // from outside (it can't live in here — no button-in-button).
              <span className="size-4 shrink-0" aria-hidden />
            ) : (
              <CaretDown
                weight="duotone"
                className="text-muted-foreground pointer-events-none size-4 shrink-0"
                aria-hidden
              />
            )}
          </PopoverTrigger>
        </div>
        {active && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()} filter`}
            onClick={() => {
              onChange([]);
              triggerRef.current?.focus();
            }}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] outline-none focus-visible:ring-3 peer-has-[:active]/filter:translate-y-[calc(-50%+4px)]"
          >
            <X weight="bold" className="size-3.5" aria-hidden />
          </button>
        )}
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
    </div>
  );
}
