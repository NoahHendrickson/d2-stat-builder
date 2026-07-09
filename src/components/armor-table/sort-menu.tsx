"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretUp,
  DotsSixVertical,
  Trash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isCustomOrderColumn,
  type CustomOrders,
  type SortKey,
  type SortState,
} from "@/lib/armor-table/filters";
import {
  activeSortMode,
  applySortLevel,
  isStatSortKey,
  moveOrderItem,
  preferredAsc,
  removeSortLevel,
  sortIndexOf,
  sortLevelFor,
  type SortMode,
} from "@/lib/armor-table/sort";

/**
 * Column-header sort control: the arrow opens a tabbed popover to pick
 * A→Z / Z→A (or High→Low / Low→High), optional Custom value order, or Clear.
 * When another column is already sorting, "Nest this sort" (default on) appends
 * a level; replacing a chain offers Undo via `sortUndo`.
 */
export function SortMenu({
  label,
  icon,
  align = "left",
  title,
  sortKey,
  sort,
  customOrders,
  values,
  hovered,
  sortUndo,
  onSortChange,
  onCustomOrderChange,
  onUndoSort,
}: {
  label: string;
  icon?: ReactNode;
  align?: "left" | "right";
  title?: string;
  sortKey: SortKey;
  sort: SortState;
  customOrders: CustomOrders;
  /** Distinct values in effective ascending order (custom-order columns only). */
  values?: string[];
  hovered: boolean;
  /** Previous chain discarded by a replace — enables Undo in the footer. */
  sortUndo: SortState | null;
  onSortChange: (
    next: SortState,
    opts?: { discardedChain?: SortState },
  ) => void;
  onCustomOrderChange: (order: string[] | undefined) => void;
  onUndoSort: () => void;
}) {
  // Default on so a stray tab click nests instead of wiping an existing chain.
  const [nest, setNest] = useState(true);
  const accessibleLabel = title ?? label;
  const levelIndex = sortIndexOf(sort, sortKey);
  const active = levelIndex !== -1;
  const level = sortLevelFor(sort, sortKey);
  const canNest = !active && sort.length > 0;
  const customized =
    isCustomOrderColumn(sortKey) && customOrders[sortKey] !== undefined;
  const mode = activeSortMode(sort, sortKey, customOrders);
  // Active columns show their real direction; inactive preview preferred.
  const asc = active
    ? mode === "custom"
      ? true
      : level!.asc
    : preferredAsc(sortKey);
  const Arrow = asc ? ArrowUp : ArrowDown;
  const numeric = isStatSortKey(sortKey);
  const canCustom = isCustomOrderColumn(sortKey);

  const sortTitle =
    active && sort.length > 1
      ? `Sort by ${accessibleLabel} (${levelIndex + 1} of ${sort.length})`
      : `Sort by ${accessibleLabel}`;

  const applyMode = (next: SortMode) => {
    if (next === "custom" && !canCustom) return;
    const nesting = nest && canNest;
    const discardedChain =
      canNest && !nesting && sort.length > 0 ? sort : undefined;
    onSortChange(applySortLevel(sort, sortKey, next, nesting), {
      discardedChain,
    });
    if (next === "custom") {
      if (!customized) {
        // Seed from the current A→Z list so reordering has a full order.
        onCustomOrderChange(values ?? []);
      }
    } else if (canCustom && customized) {
      onCustomOrderChange(undefined);
    }
  };

  const move = (from: number, to: number) => {
    if (!values || from === to) return;
    onCustomOrderChange(moveOrderItem(values, from, to));
  };

  return (
    <Popover
      onOpenChange={(open) => {
        // Re-arm nest-by-default whenever the menu opens on a nestable column.
        if (open) setNest(true);
      }}
    >
      <PopoverTrigger
        aria-label={sortTitle}
        title={sortTitle}
        className={cn(
          // Arrow sits in an absolute icon-button chrome so it never shifts
          // the label/icon away from the body cell content.
          "group relative -my-0.5 inline-flex cursor-pointer items-center",
          // 16px arrow button + 2px gap from the label/icon.
          align === "right" ? "w-full justify-center" : "pr-[18px]",
        )}
      >
        {icon ?? label}
        <span
          aria-hidden
          className={cn(
            "absolute flex size-4 items-center justify-center rounded-[4px] transition-colors",
            "hover:bg-accent group-data-popup-open:bg-accent",
            align === "right"
              ? "top-1/2 left-[calc(50%+0.5rem+2px)] -translate-y-1/2"
              : "top-1/2 right-0 -translate-y-1/2",
          )}
        >
          <Arrow
            weight="bold"
            className={cn(
              "size-3 transition-opacity",
              active
                ? "text-brand opacity-100"
                : hovered
                  ? "opacity-40"
                  : "opacity-0 group-hover:opacity-40 group-data-popup-open:opacity-100",
            )}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align={align === "right" ? "end" : "start"}
        className="w-64 p-0"
      >
        <div className="border-border/50 flex items-start gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Sort by {accessibleLabel}</p>
            {active && sort.length > 1 && (
              <p className="text-muted-foreground text-xs">
                Nest level {levelIndex + 1} of {sort.length}
              </p>
            )}
          </div>
          <div className="-mr-1 flex shrink-0 items-center">
            {sortUndo && (
              <button
                type="button"
                aria-label="Undo previous sort"
                title="Undo previous sort"
                onClick={onUndoSort}
                className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 flex size-7 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2"
              >
                <ArrowCounterClockwise
                  weight="bold"
                  className="size-3.5"
                  aria-hidden
                />
              </button>
            )}
            <button
              type="button"
              aria-label="Clear sort"
              title="Clear sort"
              disabled={!active}
              onClick={() =>
                onSortChange(removeSortLevel(sort, sortKey), {
                  discardedChain: sort,
                })
              }
              className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 flex size-7 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30"
            >
              <Trash weight="bold" className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
        {canNest && (
          <label className="hover:bg-accent flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
            <Checkbox
              checked={nest}
              onCheckedChange={(checked) => setNest(checked === true)}
            />
            <span>Nest this sort</span>
          </label>
        )}
        <Tabs
          value={mode ?? ""}
          onValueChange={(v) => {
            if (v === "asc" || v === "desc" || v === "custom") applyMode(v);
          }}
          className="gap-0 pb-2"
        >
          <div className="px-2 pt-2">
            <TabsList className="w-full justify-center">
              {numeric ? (
                <>
                  <TabsTrigger value="desc" className="flex-1 px-2 text-xs">
                    High→Low
                  </TabsTrigger>
                  <TabsTrigger value="asc" className="flex-1 px-2 text-xs">
                    Low→High
                  </TabsTrigger>
                </>
              ) : (
                <>
                  <TabsTrigger value="asc" className="flex-1 px-2 text-xs">
                    A→Z
                  </TabsTrigger>
                  <TabsTrigger value="desc" className="flex-1 px-2 text-xs">
                    Z→A
                  </TabsTrigger>
                </>
              )}
              {canCustom && (
                <TabsTrigger value="custom" className="flex-1 px-2 text-xs">
                  Custom
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          {canCustom && (
            <TabsContent value="custom" className="mt-0">
              <CustomOrderList values={values ?? []} onMove={move} />
              <div className="border-border/50 flex items-center justify-between gap-2 border-t p-1.5">
                <span className="text-muted-foreground px-1 text-xs">
                  {customized ? "Custom order" : "Default (A–Z)"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  disabled={!customized}
                  onClick={() => {
                    onCustomOrderChange(undefined);
                    const nesting = nest && canNest;
                    onSortChange(
                      applySortLevel(sort, sortKey, "asc", nesting),
                      {
                        discardedChain:
                          canNest && !nesting && sort.length > 0
                            ? sort
                            : undefined,
                      },
                    );
                  }}
                >
                  Reset
                </Button>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function CustomOrderList({
  values,
  onMove,
}: {
  values: string[];
  onMove: (from: number, to: number) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  /** Insertion slot 0…length (before that index / after the last). */
  const [insertBefore, setInsertBefore] = useState<number | null>(null);

  const clearDrag = () => {
    setDragFrom(null);
    setInsertBefore(null);
  };

  const onDragStart = (e: DragEvent, index: number) => {
    setDragFrom(index);
    setInsertBefore(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const slotFromPointer = (e: DragEvent, index: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    return e.clientY < mid ? index : index + 1;
  };

  const onDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setInsertBefore(slotFromPointer(e, index));
  };

  const onDrop = (e: DragEvent, index: number) => {
    e.preventDefault();
    const from =
      dragFrom ?? Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
    const slot = insertBefore ?? slotFromPointer(e, index);
    clearDrag();
    if (Number.isNaN(from)) return;
    // No-op if dropping into the gap immediately before/after itself.
    if (slot === from || slot === from + 1) return;
    // Convert insertion slot → moveOrderItem `to` (accounts for the remove).
    const to = from < slot ? slot - 1 : slot;
    onMove(from, to);
  };

  if (values.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-2 text-center text-xs">
        No values to order.
      </p>
    );
  }

  const showSlot = (slot: number) =>
    dragFrom !== null &&
    insertBefore === slot &&
    slot !== dragFrom &&
    slot !== dragFrom + 1;

  return (
    <ul className="max-h-72 overflow-y-auto p-1">
      {values.map((value, i) => (
        <li key={value} className="relative">
          {showSlot(i) && (
            <div
              aria-hidden
              className="bg-brand pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full"
            />
          )}
          <div
            draggable
            onDragStart={(e) => onDragStart(e, i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDrop={(e) => onDrop(e, i)}
            onDragEnd={clearDrag}
            className={cn(
              "group/row hover:bg-accent flex cursor-grab items-center gap-1 rounded-md py-0.5 pr-0.5 pl-1 text-sm active:cursor-grabbing",
              dragFrom === i && "bg-accent opacity-60",
            )}
          >
            <DotsSixVertical
              weight="bold"
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
            <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
              {i + 1}.
            </span>
            <span className="min-w-0 flex-1 truncate">{value}</span>
            <span className="flex shrink-0 opacity-0 group-hover/row:opacity-100 has-focus-visible:opacity-100">
              <button
                type="button"
                aria-label={`Move ${value} up`}
                disabled={i === 0}
                onClick={() => onMove(i, i - 1)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30"
              >
                <CaretUp weight="bold" className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Move ${value} down`}
                disabled={i === values.length - 1}
                onClick={() => onMove(i, i + 1)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30"
              >
                <CaretDown weight="bold" className="size-3.5" aria-hidden />
              </button>
            </span>
          </div>
          {i === values.length - 1 && showSlot(values.length) && (
            <div
              aria-hidden
              className="bg-brand pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
