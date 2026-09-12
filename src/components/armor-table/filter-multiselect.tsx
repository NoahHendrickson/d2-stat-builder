"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useLayoutEffect, useRef, useState } from "react";
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

/**
 * Comma-separated labels that hug their text, then collapse trailing values
 * into "+N more" only when the trigger is actually narrower than the list.
 */
function OverflowSelection({ labels }: { labels: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const labelsKey = labels.join("\0");

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const fit = () => {
      const items = [
        ...root.querySelectorAll<HTMLElement>(":scope > [data-item]"),
      ];
      const more = root.querySelector<HTMLElement>(":scope > [data-more]");
      if (items.length === 0 || root.clientWidth <= 0) return;

      const apply = (count: number) => {
        for (let i = 0; i < items.length; i++) {
          items[i].hidden = i >= count;
        }
        const rest = items.length - count;
        if (more) {
          more.hidden = rest <= 0;
          if (rest > 0) more.textContent = ` +${rest} more`;
        }
        const squeezeFirst = count === 1;
        items[0].classList.toggle("min-w-0", squeezeFirst);
        items[0].classList.toggle("flex-1", squeezeFirst);
        items[0].classList.toggle("truncate", squeezeFirst);
        items[0].classList.toggle("shrink-0", !squeezeFirst);
      };

      apply(items.length);
      if (root.scrollWidth <= root.clientWidth + 1) return;

      for (let count = items.length - 1; count >= 1; count--) {
        apply(count);
        if (root.scrollWidth <= root.clientWidth + 1) return;
      }
      apply(1);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [labelsKey]);

  return (
    <span
      ref={ref}
      className="flex min-w-0 grow overflow-hidden text-left"
    >
      {labels.map((label, i) => (
        <span key={`${i}:${label}`} data-item className="shrink-0">
          {i > 0 ? `, ${label}` : label}
        </span>
      ))}
      <span data-more className="shrink-0" hidden />
    </span>
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
  const labels = selectedLabels(value, options);
  const summaryText = selectionSummaryText(value, options);

  return (
    <div
      className={cn(
        "relative w-max max-w-full overflow-visible",
        active ? "min-w-0" : "shrink-0",
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
              {active ? (
                <OverflowSelection labels={labels} />
              ) : (
                <span className="min-w-0 truncate text-left text-muted-foreground">
                  {allLabel}
                </span>
              )}
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
