"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useDragReorder } from "@/components/armor-table/use-drag-reorder";

/**
 * Drag-reorderable list of distinct column values for a custom sort level.
 * Shows a brand insertion divider while dragging so the drop slot is clear.
 */
export function CustomOrderList({
  values,
  onMove,
}: {
  values: string[];
  onMove: (from: number, to: number) => void;
}) {
  const { dragFrom, rowProps, showSlot } = useDragReorder(onMove);

  if (values.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-2 text-center text-xs">
        No values to order.
      </p>
    );
  }

  return (
    <ul className="max-h-72 overflow-y-auto p-1">
      {values.map((value, i) => (
        <li key={value} className="relative">
          {showSlot(i) && (
            <div
              aria-hidden
              className="bg-foreground pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 -translate-y-1/2 rounded-none"
            />
          )}
          <div
            {...rowProps(i)}
            className={cn(
              "group/row hover:bg-accent flex h-8 cursor-grab items-center gap-1.5 rounded-none normal:rounded-[6px] pr-0.5 pl-1.5 text-sm active:cursor-grabbing",
              dragFrom === i && "bg-accent opacity-60",
            )}
          >
            <HugeiconsIcon icon={DragDropVerticalIcon}
              strokeWidth={2}
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
            <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
              {i + 1}.
            </span>
            <span className="min-w-0 flex-1 truncate">{value}</span>
            <span className="flex shrink-0 opacity-0 group-hover/row:opacity-100 has-focus-visible:opacity-100">
              <TooltipLabel label={`Move ${value} up`}>
                <button
                  type="button"
                  aria-label={`Move ${value} up`}
                  disabled={i === 0}
                  onClick={() => onMove(i, i - 1)}
                  className="text-muted-foreground hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-none normal:rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-outline-strong disabled:pointer-events-none disabled:opacity-30"
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
                </button>
              </TooltipLabel>
              <TooltipLabel label={`Move ${value} down`}>
                <button
                  type="button"
                  aria-label={`Move ${value} down`}
                  disabled={i === values.length - 1}
                  onClick={() => onMove(i, i + 1)}
                  className="text-muted-foreground hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-none normal:rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-outline-strong disabled:pointer-events-none disabled:opacity-30"
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
                </button>
              </TooltipLabel>
            </span>
          </div>
          {i === values.length - 1 && showSlot(values.length) && (
            <div
              aria-hidden
              className="bg-foreground pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-none"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
