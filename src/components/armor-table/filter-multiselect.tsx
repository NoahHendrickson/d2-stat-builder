"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Pin02Icon, Search01Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { partitionByPin, type FilterOption } from "@/lib/armor-table/pinned";
import {
  fieldControlInnerTriggerClasses,
  fieldFilterActiveEdgeClasses,
  fieldFilterControlShellClasses,
  fieldFilterIdleClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";
import { Input, SearchClearButton } from "@/components/ui/input";
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
  /**
   * Pick exactly one: choosing an option replaces the value and closes the menu, and
   * there's no Clear row. With `noneLabel`, a first row picks nothing (`[]`).
   */
  single?: boolean;
  noneLabel?: string;
  options: FilterOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
  /**
   * Cap the unsearched list at this many rows (selected options first). Long
   * option lists (hundreds of perks) otherwise mount every row on open.
   */
  maxVisible?: number;
};

/** Checkbox list body shared by FilterMultiselect and FilterCascadeMenu submenus. */
export function FilterMultiselectPanel<V extends string | number>({
  allLabel,
  single = false,
  noneLabel,
  options,
  value,
  onChange,
  query,
  onQueryChange,
  searchable = false,
  pinnable = false,
  pinned = [],
  onTogglePin,
  maxVisible,
}: FilterMultiselectPanelProps<V>) {
  const active = value.length > 0;
  const partition = partitionByPin(options, pinnable ? pinned : [], query);
  const capped =
    maxVisible != null && !query.trim() && partition.rest.length > maxVisible;
  const rest = capped
    ? [
        ...partition.rest.filter((opt) => value.includes(opt.value)),
        ...partition.rest.filter((opt) => !value.includes(opt.value)),
      ].slice(0, maxVisible)
    : partition.rest;
  const hiddenCount = partition.rest.length - rest.length;

  const toggle = (v: V) =>
    onChange(
      single
        ? [v]
        : value.includes(v)
          ? value.filter((x) => !Object.is(x, v))
          : [...value, v],
    );

  const renderOption = (opt: FilterOption<V>) => {
    const isPinned = pinned.includes(opt.value);
    return (
      <DropdownMenuCheckboxItem
        key={String(opt.value)}
        indicator="start"
        closeOnClick={single}
        checked={value.includes(opt.value)}
        onCheckedChange={() => toggle(opt.value)}
      >
        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
        {opt.count !== undefined && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{opt.count}</span>
        )}
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
                "relative flex size-7 shrink-0 items-center justify-center rounded-none normal:rounded-[8px] transition-opacity outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-outline-strong",
                isPinned
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground opacity-0 group-hover/dropdown-menu-checkbox-item:opacity-100",
              )}
            >
              <HugeiconsIcon icon={Pin02Icon}
                fill={isPinned ? "currentColor" : "none"}
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
            <HugeiconsIcon icon={Search01Icon}
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
              className="pr-8 pl-8"
            />
            {query.length > 0 && <SearchClearButton onClick={() => onQueryChange("")} />}
          </div>
        </div>
      )}
      {noneLabel && !query.trim() && (
        <>
          <DropdownMenuCheckboxItem
            indicator="start"
            checked={value.length === 0}
            onCheckedChange={() => onChange([])}
          >
            <span className="min-w-0 flex-1 truncate">{noneLabel}</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
        </>
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
      {rest.map(renderOption)}
      {hiddenCount > 0 && (
        <p className="text-muted-foreground px-1.5 py-2 text-xs">
          {hiddenCount.toLocaleString()} more. Type to search.
        </p>
      )}
      {partition.pinned.length === 0 && partition.rest.length === 0 && (
        <p className="text-muted-foreground px-1.5 py-2 text-center text-xs">
          No matches.
        </p>
      )}
      {active && !single && (
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
  single = false,
  required = false,
  noneLabel,
  options,
  value,
  onChange,
  searchable = false,
  pinnable = false,
  pinned = [],
  onTogglePin,
  maxVisible,
  className,
}: {
  label: string;
  allLabel: string;
  /** Pick one (see {@link FilterMultiselectPanel}); the trigger shows the pick alone. */
  single?: boolean;
  /** A single pick that can't be cleared: no clear button, never the idle look. */
  required?: boolean;
  noneLabel?: string;
  options: FilterOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  searchable?: boolean;
  pinnable?: boolean;
  pinned?: V[];
  onTogglePin?: (value: V) => void;
  /** See {@link FilterMultiselectPanel}. */
  maxVisible?: number;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = value.length > 0;
  const labels = selectedLabels(value, options);
  const summaryText = labels.length === 0 ? null : labels.join(", ");
  const clearable = active && !required;
  // A filter in effect gets the active fill; a single pick (a choice, not a filter) doesn't.
  const highlighted = active && !single;
  const pickCount = single ? options.find((o) => Object.is(o.value, value[0]))?.count : undefined;
  const triggerLabel = active
    ? single
      ? `${label}: ${summaryText}`
      : `${label}: ${summaryText} — ${value.length} selected`
    : `${label}: ${allLabel}`;

  return (
    <div
      // Sized to its label, not stretched: a crowded row still shrinks it to truncate.
      className={cn("relative w-max min-w-0 max-w-full overflow-visible", className)}
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
            highlighted ? fieldFilterActiveEdgeClasses : fieldFilterIdleClasses,
          )}
          data-active={highlighted || undefined}
        >
          <TooltipLabel label={triggerLabel}>
            <DropdownMenuTrigger
              ref={triggerRef}
              aria-label={triggerLabel}
              className={fieldControlInnerTriggerClasses}
            >
              {active ? (
                <>
                  {single ? (
                    <span className="min-w-0 grow truncate text-left">
                      {summaryText}
                      {pickCount !== undefined && (
                        <span className="text-white/70"> ({pickCount})</span>
                      )}
                    </span>
                  ) : (
                    // "Class: Titan" — the muted name keeps what's filtered in view.
                    <span className="min-w-0 grow truncate text-left">
                      <span className="text-white/70">{label}:</span> {summaryText}
                    </span>
                  )}
                  {clearable && <span className="size-4 shrink-0" aria-hidden />}
                </>
              ) : (
                <span className="min-w-0 truncate text-left text-foreground/70">
                  {allLabel}
                </span>
              )}
              <HugeiconsIcon icon={UnfoldMoreIcon}
                className={cn(
                  "pointer-events-none size-4 shrink-0",
                  highlighted ? "text-white" : "text-foreground/70",
                )}
                aria-hidden
              />
            </DropdownMenuTrigger>
          </TooltipLabel>
        </div>
        {clearable && (
          <TooltipLabel label={`Clear ${label.toLowerCase()}${single ? "" : " filter"}`}>
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}${single ? "" : " filter"}`}
              onClick={() => {
                onChange([]);
                triggerRef.current?.focus();
              }}
              className="absolute top-1/2 right-8 flex size-4 -translate-y-1/2 items-center justify-center rounded-none normal:rounded-[4px] text-current outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
            </button>
          </TooltipLabel>
        )}
        <DropdownMenuContent
          align="start"
          className={searchable ? "w-64" : undefined}
        >
          <FilterMultiselectPanel
            allLabel={allLabel}
            single={single}
            noneLabel={noneLabel}
            options={options}
            value={value}
            onChange={onChange}
            query={query}
            onQueryChange={setQuery}
            searchable={searchable}
            pinnable={pinnable}
            pinned={pinned}
            onTogglePin={onTogglePin}
            maxVisible={maxVisible}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
