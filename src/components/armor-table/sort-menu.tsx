"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { memo, type ReactNode } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  ListOrderedIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
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
  sortLevelAsc,
  type CustomOrderColumn,
  type SortKey,
  type SortState,
} from "@/lib/armor-table/filters";
import {
  activeSortMode,
  applyCustomOrder,
  preferredAsc,
  sortIndexOf,
  sortKeyLabel,
  sortModeLabel,
  sortModesFor,
  type SortMode,
} from "@/lib/armor-table/sort";
import { CustomOrderList } from "@/components/armor-table/custom-order-list";
import type { SortActions } from "@/components/armor-table/use-armor-table-sort";

/**
 * A faint foreground tint over the pane, so the toolbar and column headers pick
 * up the same backdrop as the rest of the page. The sticky thead adds a blur on
 * top so rows scrolling under it smear instead of reading through.
 */
export const TABLE_HEADER_BG = "bg-foreground/8";

const TABLE_HEAD_CELL =
  "border-b border-foreground/15 py-2.5 pr-2 @max-[81.5rem]/armor:pr-1 text-sm font-normal whitespace-nowrap first:pl-3 " +
  // Phones pin the name column (see armor-table-row.tsx): the header cell over it
  // needs the band's wash on a solid fill.
  "max-md:first:sticky max-md:first:left-0 max-md:first:z-[1] max-md:first:shadow-[1px_0_0_var(--border)] max-md:first:[background:linear-gradient(color-mix(in_oklab,var(--foreground)_8%,transparent),color-mix(in_oklab,var(--foreground)_8%,transparent)),var(--glass-opaque)]";

const MODE_ICONS: Record<SortMode, typeof ArrowUp02Icon> = {
  asc: ArrowUp02Icon,
  desc: ArrowDown02Icon,
  custom: ListOrderedIcon,
};

function ModeIcon({ mode }: { mode: SortMode }) {
  return (
    <HugeiconsIcon
      icon={MODE_ICONS[mode]}
      strokeWidth={2}
      className="text-muted-foreground size-3.5"
      aria-hidden
    />
  );
}

/** "1st", "2nd", "3rd", "4th"… for a chain position. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * The body of one column's sort menu in its header. A column outside the chain
 * offers "Sort by" (replace) and "Then by" (add after the current sorts) as plain
 * picks. A column in the chain edits its level in place: direction or custom
 * order, moving it first, keeping only it, or removing it.
 */
export function SortLevelMenuItems({
  sortKey,
  sort,
  values,
  sortUndo,
  actions,
}: {
  sortKey: SortKey;
  sort: SortState;
  /** Distinct values in effective ascending order (custom-order columns only). */
  values?: string[];
  sortUndo: SortState | null;
  actions: SortActions;
}) {
  const label = sortKeyLabel(sortKey);
  const index = sortIndexOf(sort, sortKey);
  const level = index === -1 ? undefined : sort[index];
  const modes = sortModesFor(sortKey);
  const order = level?.kind === "custom" ? level.order : undefined;

  const pick = (mode: SortMode, nest: boolean) =>
    actions.applyMode(
      sortKey,
      mode,
      nest,
      mode === "custom" ? (order ?? values ?? []) : undefined,
    );

  const undo = sortUndo && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={actions.undoSort}>
        Undo last sort change
      </DropdownMenuItem>
    </>
  );

  if (!level) {
    // Custom keeps the menu open: it turns into this column's level, order list and all.
    const items = (nest: boolean) =>
      modes.map((mode) => (
        <DropdownMenuItem
          key={mode}
          closeOnClick={mode !== "custom"}
          onClick={() => pick(mode, nest)}
        >
          <ModeIcon mode={mode} />
          {sortModeLabel(sortKey, mode)}
        </DropdownMenuItem>
      ));
    return (
      <>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by {label}</DropdownMenuLabel>
          {items(false)}
        </DropdownMenuGroup>
        {sort.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex justify-between gap-3">
                <span>Then by {label}</span>
                <span className="font-normal">{ordinal(sort.length + 1)} sort</span>
              </DropdownMenuLabel>
              {items(true)}
            </DropdownMenuGroup>
          </>
        )}
        {undo}
      </>
    );
  }

  // Reset puts the values back A→Z.
  const resetOrder = values ? applyCustomOrder(values, undefined) : [];
  const isReset =
    values !== undefined && values.every((v, i) => v === resetOrder[i]);

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex justify-between gap-3">
          <span>Sort by {label}</span>
          {sort.length > 1 && (
            <span className="font-normal">
              {ordinal(index + 1)} of {sort.length}
            </span>
          )}
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuRadioGroup
        value={activeSortMode(sort, sortKey) ?? ""}
        onValueChange={(v) => {
          if (v === "asc" || v === "desc" || v === "custom") pick(v, false);
        }}
      >
        {modes.map((mode) => (
          <DropdownMenuRadioItem key={mode} value={mode} closeOnClick={false}>
            {sortModeLabel(sortKey, mode)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {order && (
        <>
          <CustomOrderList
            values={values ?? []}
            onMove={(from, to) =>
              actions.reorderCustom(sortKey as CustomOrderColumn, from, to)
            }
          />
          <DropdownMenuItem
            closeOnClick={false}
            disabled={isReset}
            onClick={() => actions.applyMode(sortKey, "custom", false, resetOrder)}
          >
            Reset to A→Z
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      {index > 0 && (
        <DropdownMenuItem onClick={() => actions.moveLevel(index, 0)}>
          Sort by {label} first
        </DropdownMenuItem>
      )}
      {sort.length > 1 && (
        <DropdownMenuItem onClick={() => actions.soloLevel(sortKey)}>
          Sort only by {label}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => actions.clearLevel(sortKey)}>
        Remove from sort
      </DropdownMenuItem>
      {undo}
    </>
  );
}

/**
 * Sortable column header: owns the `<th>` chrome and the column's sort menu
 * (see SortLevelMenuItems). A sorting column shows its arrow; with more than one
 * sort, a small number beside it gives the column's place in the chain. Columns
 * with a toolbar filter put its button (`filter`) after the sort button.
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
  actions,
  filter,
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
  actions: SortActions;
  /** The column's filter button (ColumnFilterMenu), after the sort button. */
  filter?: ReactNode;
}) {
  const accessibleLabel = title ?? label;
  const levelIndex = sortIndexOf(sort, sortKey);
  const active = levelIndex !== -1;
  const level = active ? sort[levelIndex] : undefined;
  const asc = level ? sortLevelAsc(level) : preferredAsc(sortKey);
  const arrow = level?.kind === "custom" ? ListOrderedIcon : asc ? ArrowUp02Icon : ArrowDown02Icon;
  const numbered = active && sort.length > 1;
  const primary = sort[0];
  const isPrimary = primary?.key === sortKey;

  const sortTitle = numbered
    ? `Sort by ${accessibleLabel} (${ordinal(levelIndex + 1)} of ${sort.length})`
    : `Sort by ${accessibleLabel}`;

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
      <div className={cn("flex min-w-0 items-center gap-0.5", align === "right" && "justify-center")}>
      <DropdownMenu modal={false}>
        <TooltipLabel label={sortTitle}>
          <DropdownMenuTrigger
            aria-label={sortTitle}
            className={cn(
              "group relative -my-0.5 flex min-w-0 cursor-pointer items-center",
              align === "right" ? "w-full justify-center" : "gap-1 @max-[81.5rem]/armor:gap-0.5",
            )}
          >
            {iconNode ?? <span className="min-w-0 truncate">{label}</span>}
            <span
              aria-hidden
              className={cn(
                "flex h-6 shrink-0 items-center justify-center rounded-none normal:rounded-[4px]",
                // The outlined buttons' hover: a fill plus the ring standing off the button.
                "d2-hover-ring transition-[background-color,outline-offset] hover:bg-foreground/6 group-data-popup-open:bg-foreground/6",
                // Stat headers center the icon alone; the button hangs off its right,
                // a size smaller so it stays inside the narrow column.
                align === "right"
                  ? cn(
                      "absolute top-1/2 left-[calc(50%+0.5rem-2px)] -translate-y-1/2",
                      numbered ? "gap-px pr-0.5 pl-px" : "w-5",
                    )
                  : numbered
                    ? "gap-px pr-1 pl-0.5"
                    : "w-6 @max-[71.5rem]/armor:w-5",
              )}
            >
              <HugeiconsIcon
                icon={arrow}
                strokeWidth={2}
                className={cn(
                  "transition-opacity",
                  align === "right" ? "size-3.5" : "size-4",
                  // Always shown: dim at rest, a little brighter in a hovered column,
                  // full on the button itself.
                  active
                    ? "text-foreground opacity-100"
                    : cn(
                        hovered ? "opacity-60" : "opacity-40",
                        "group-hover:text-foreground group-hover:opacity-100 group-data-popup-open:text-foreground group-data-popup-open:opacity-100",
                      ),
                )}
              />
              {numbered && (
                <span className="text-foreground text-[11px] leading-none font-medium tabular-nums">
                  {levelIndex + 1}
                </span>
              )}
            </span>
          </DropdownMenuTrigger>
        </TooltipLabel>
        <DropdownMenuContent
          align={align === "right" ? "end" : "start"}
          className="w-60"
        >
          <SortLevelMenuItems
            sortKey={sortKey}
            sort={sort}
            values={values}
            sortUndo={sortUndo}
            actions={actions}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {filter}
      </div>
    </th>
  );
});
