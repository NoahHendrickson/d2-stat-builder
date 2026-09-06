"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useState, type ReactNode } from "react";
import Image from "next/image";
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
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
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  isCustomOrderColumn,
  sortLevelAsc,
  type CustomOrderColumn,
  type SortKey,
  type SortState,
} from "@/lib/armor-table/filters";
import {
  activeSortMode,
  isStatSortKey,
  preferredAsc,
  type SortMode,
} from "@/lib/armor-table/sort";
import { CustomOrderList } from "@/components/armor-table/custom-order-list";

const TABLE_HEAD_CELL =
  "border-border/50 border-b bg-[color-mix(in_oklch,var(--muted)_55%,var(--background))] py-2.5 pr-3 text-sm font-medium whitespace-nowrap first:pl-3";

/**
 * Sortable column header: owns the `<th>` chrome and a tabbed popover for
 * A→Z / Z→A (or High→Low / Low→High), optional Custom value order, nest, and
 * clear/undo. Sort state is a single nest chain of dir|custom levels.
 */
export function SortMenu({
  label,
  icon,
  align = "left",
  title,
  sortKey,
  sort,
  values,
  hovered,
  sortUndo,
  onApplyMode,
  onClearLevel,
  onReorderCustom,
  onUndoSort,
}: {
  label: string;
  icon?: string;
  align?: "left" | "right";
  title?: string;
  sortKey: SortKey;
  sort: SortState;
  /** Distinct values in effective ascending order (custom-order columns only). */
  values?: string[];
  hovered: boolean;
  sortUndo: SortState | null;
  onApplyMode: (
    key: SortKey,
    mode: SortMode,
    nest: boolean,
    order?: string[],
  ) => void;
  onClearLevel: (key: SortKey) => void;
  onReorderCustom: (key: CustomOrderColumn, from: number, to: number) => void;
  onUndoSort: () => void;
}) {
  // Default off so picking a new column replaces the chain; nest is opt-in.
  const [nest, setNest] = useState(false);
  const accessibleLabel = title ?? label;
  const levelIndex = sort.findIndex((l) => l.key === sortKey);
  const active = levelIndex !== -1;
  const level = active ? sort[levelIndex] : undefined;
  const canNest = !active && sort.length > 0;
  const customized = level?.kind === "custom";
  const mode = activeSortMode(sort, sortKey);
  const asc = active ? sortLevelAsc(level!) : preferredAsc(sortKey);
  const Arrow = asc ? ArrowUp : ArrowDown;
  const numeric = isStatSortKey(sortKey);
  const canCustom = isCustomOrderColumn(sortKey);
  const primary = sort[0];
  const isPrimary = primary?.key === sortKey;

  const sortTitle =
    active && sort.length > 1
      ? `Sort by ${accessibleLabel} (${levelIndex + 1} of ${sort.length})`
      : `Sort by ${accessibleLabel}`;

  const applyMode = (next: SortMode) => {
    if (next === "custom" && !canCustom) return;
    const nesting = nest && canNest;
    const order =
      next === "custom"
        ? customized && level?.kind === "custom"
          ? level.order
          : (values ?? [])
        : undefined;
    onApplyMode(sortKey, next, nesting, order);
  };

  const iconNode: ReactNode = icon ? (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${icon}`}
      alt={accessibleLabel}
      width={16}
      height={16}
      className="size-4 shrink-0 invert dark:invert-0"
      unoptimized
    />
  ) : undefined;

  return (
    <th
      className={cn(TABLE_HEAD_CELL, align === "right" && "pr-0")}
      aria-sort={
        isPrimary
          ? sortLevelAsc(primary)
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <Popover
        onOpenChange={(open) => {
          if (open) setNest(false);
        }}
      >
        <TooltipLabel label={sortTitle}>
          <PopoverTrigger
            aria-label={sortTitle}

            className={cn(
              "group relative -my-0.5 inline-flex cursor-pointer items-center",
              align === "right" ? "w-full justify-center" : "pr-[18px]",
            )}
          >
            {iconNode ?? label}
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
        </TooltipLabel>
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
                <TooltipLabel label="Undo previous sort">
                  <button
                    type="button"
                    aria-label="Undo previous sort"

                    onClick={onUndoSort}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 flex size-7 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2"
                  >
                    <ArrowCounterClockwise
                      weight="bold"
                      className="size-3.5"
                      aria-hidden
                    />
                  </button>
                </TooltipLabel>
              )}
              <TooltipLabel label="Clear sort">
                <button
                  type="button"
                  aria-label="Clear sort"

                  disabled={!active}
                  onClick={() => onClearLevel(sortKey)}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 flex size-7 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash weight="bold" className="size-3.5" aria-hidden />
                </button>
              </TooltipLabel>
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
                <CustomOrderList
                  values={values ?? []}
                  onMove={(from, to) =>
                    onReorderCustom(sortKey as CustomOrderColumn, from, to)
                  }
                />
                <div className="border-border/50 flex items-center justify-between gap-2 border-t p-1.5">
                  <span className="text-muted-foreground px-1 text-xs">
                    {customized ? "Custom order" : "Default (A–Z)"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    disabled={!customized}
                    onClick={() => onApplyMode(sortKey, "asc", nest && canNest)}
                  >
                    Reset
                  </Button>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </PopoverContent>
      </Popover>
    </th>
  );
}
