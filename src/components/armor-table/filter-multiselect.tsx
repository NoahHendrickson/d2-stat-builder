"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useRef, useState } from "react";
import { CaretUpDown, MagnifyingGlass, PushPin, X } from "@phosphor-icons/react";
import { partitionByPin, type FilterOption } from "@/lib/armor-table/pinned";
import {
  fieldControlInnerTriggerClasses,
  fieldFilterActiveEdgeClasses,
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

/** Selected option labels in selection order. */
export function selectedLabels<V>(
  selected: readonly V[],
  options: readonly FilterOption<V>[],
): string[] {
  return selected.map(
    (v) => options.find((o) => Object.is(o.value, v))?.label ?? String(v),
  );
}

/** All selected labels joined with ", ", or null when empty. */
export function selectionSummaryText<V>(
  selected: readonly V[],
  options: readonly FilterOption<V>[],
): string | null {
  const labels = selectedLabels(selected, options);
  return labels.length === 0 ? null : labels.join(", ");
}

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
  const labels = selectedLabels(value, options);
  const summaryText = labels.length === 0 ? null : labels.join(", ");

  return (
    <div
      className={cn(
        "relative min-w-0 max-w-full overflow-visible",
        active ? "flex-1" : "w-max",
        className,
      )}
    >
      <DropdownMenu
        modal={false}
        onOpenChange={(next) => {
          if (!next) setQuery("");
        }}
      >
        <div
          className={cn(
            fieldFilterControlShellClasses,
            "box-border w-full",
            active && fieldFilterActiveEdgeClasses,
          )}
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
              {active ? (
                <>
                  <span className="min-w-0 grow truncate text-left">
                    {summaryText}
                  </span>
                  <span className="size-4 shrink-0" aria-hidden />
                </>
              ) : (
                <span className="min-w-0 truncate text-left text-foreground/70">
                  {allLabel}
                </span>
              )}
              <CaretUpDown
                className={cn(
                  "pointer-events-none size-4 shrink-0",
                  active ? "text-emphatic-foreground" : "text-foreground/70",
                )}
                aria-hidden
              />
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
              className="text-emphatic-foreground focus-visible:ring-ring/50 absolute top-1/2 right-8 flex size-4 -translate-y-1/2 items-center justify-center rounded-[4px] outline-none focus-visible:ring-3"
            >
              <X className="size-4" aria-hidden />
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
