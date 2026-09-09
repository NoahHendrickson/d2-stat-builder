"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { memo, useState, type ReactNode } from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  "border-border/50 bg-[color-mix(in_oklch,var(--muted)_55%,var(--background))] border-b py-2.5 pr-3 text-sm font-medium whitespace-nowrap first:pl-3";

/**
 * Sortable column header: owns the `<th>` chrome and a dropdown for
 * A→Z / Z→A (or High→Low / Low→High), optional Custom value order, nest, and
 * clear/undo. Sort state is a single nest chain of dir|custom levels.
 */
export const SortMenu = memo(function SortMenu({
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
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setNest(false);
        }}
      >
        <TooltipLabel label={sortTitle}>
          <DropdownMenuTrigger
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
          </DropdownMenuTrigger>
        </TooltipLabel>
        <DropdownMenuContent
          align={align === "right" ? "end" : "start"}
          className="w-56"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              Sort by {accessibleLabel}
              {active && sort.length > 1
                ? ` (${levelIndex + 1} of ${sort.length})`
                : ""}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {canNest && (
            <DropdownMenuCheckboxItem
              closeOnClick={false}
              checked={nest}
              onCheckedChange={(checked) => setNest(checked === true)}
            >
              Nest this sort
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuRadioGroup
            value={mode ?? ""}
            onValueChange={(v) => {
              if (v === "asc" || v === "desc" || v === "custom") applyMode(v);
            }}
          >
            {numeric ? (
              <>
                <DropdownMenuRadioItem value="desc">
                  High→Low
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="asc">
                  Low→High
                </DropdownMenuRadioItem>
              </>
            ) : (
              <>
                <DropdownMenuRadioItem value="asc">A→Z</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">Z→A</DropdownMenuRadioItem>
              </>
            )}
            {canCustom && (
              <DropdownMenuRadioItem value="custom" closeOnClick={false}>
                Custom
              </DropdownMenuRadioItem>
            )}
          </DropdownMenuRadioGroup>
          {canCustom && mode === "custom" && (
            <>
              <CustomOrderList
                values={values ?? []}
                onMove={(from, to) =>
                  onReorderCustom(sortKey as CustomOrderColumn, from, to)
                }
              />
              <DropdownMenuItem
                disabled={!customized}
                onClick={() => onApplyMode(sortKey, "asc", nest && canNest)}
              >
                Reset order
              </DropdownMenuItem>
            </>
          )}
          {(sortUndo || active) && <DropdownMenuSeparator />}
          {sortUndo && (
            <DropdownMenuItem onClick={onUndoSort}>
              Undo previous sort
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem onClick={() => onClearLevel(sortKey)}>
              Clear sort
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </th>
  );
});
