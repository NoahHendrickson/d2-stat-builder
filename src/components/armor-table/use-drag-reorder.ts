"use client";

import { useState, type DragEvent } from "react";

/**
 * Native drag-and-drop reordering for a vertical list. Rows spread `rowProps(i)`;
 * `showSlot(slot)` says where to draw the insertion line (slot 0…length means
 * "before that index" / "after the last"). `onMove` gets moveOrderItem's from → to.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [insertBefore, setInsertBefore] = useState<number | null>(null);

  const clearDrag = () => {
    setDragFrom(null);
    setInsertBefore(null);
  };

  const slotFromPointer = (e: DragEvent, index: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
  };

  const rowProps = (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragFrom(index);
      setInsertBefore(null);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setInsertBefore(slotFromPointer(e, index));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const from =
        dragFrom ?? Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
      const slot = insertBefore ?? slotFromPointer(e, index);
      clearDrag();
      if (Number.isNaN(from)) return;
      // No-op if dropping into the gap immediately before/after itself.
      if (slot === from || slot === from + 1) return;
      // Convert insertion slot → moveOrderItem `to` (accounts for the remove).
      onMove(from, from < slot ? slot - 1 : slot);
    },
    onDragEnd: clearDrag,
  });

  const showSlot = (slot: number) =>
    dragFrom !== null &&
    insertBefore === slot &&
    slot !== dragFrom &&
    slot !== dragFrom + 1;

  return { dragFrom, rowProps, showSlot };
}
