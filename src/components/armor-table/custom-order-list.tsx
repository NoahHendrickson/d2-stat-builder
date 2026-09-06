"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useState, type DragEvent } from "react";
import { CaretDown, CaretUp, DotsSixVertical } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

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
              <TooltipLabel label={`Move ${value} up`}>
                <button
                  type="button"
                  aria-label={`Move ${value} up`}
                  disabled={i === 0}
                  onClick={() => onMove(i, i - 1)}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30"
                >
                  <CaretUp weight="bold" className="size-3.5" aria-hidden />
                </button>
              </TooltipLabel>
              <TooltipLabel label={`Move ${value} down`}>
                <button
                  type="button"
                  aria-label={`Move ${value} down`}
                  disabled={i === values.length - 1}
                  onClick={() => onMove(i, i + 1)}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30"
                >
                  <CaretDown weight="bold" className="size-3.5" aria-hidden />
                </button>
              </TooltipLabel>
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
