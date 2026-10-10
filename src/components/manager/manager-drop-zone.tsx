"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Landing } from "@/lib/inventory/moves";
import { cn } from "@/lib/utils";
import { createValueStore, useStoreValue } from "@/lib/value-store";
import {
  dragStore,
  useManagerActions,
  type DragInfo,
  type ManagerActions,
} from "./manager-context";

/**
 * The character whose column a drop would go through (the pointer is on its column but
 * not on a slot that takes the item): the item's slot row there lights up as the landing.
 */
export const characterDropStore = createValueStore<string | null>(null);

/**
 * Whether the dragged item can land at `to`, planned once per drag and landing: every
 * slot row of a character is a zone for the same landing, and they all re-render as the
 * lit character changes.
 */
const acceptCache = new WeakMap<DragInfo, Map<string, boolean>>();
export function canLand(actions: ManagerActions, drag: DragInfo, to: Landing): boolean {
  const key = to.kind === "vault" ? "vault" : `${to.characterId}:${to.equipped ? "e" : ""}`;
  let byLanding = acceptCache.get(drag);
  if (!byLanding) acceptCache.set(drag, (byLanding = new Map()));
  let ok = byLanding.get(key);
  if (ok === undefined) {
    ok = actions.problem(drag.item, drag.place, to) === null;
    byLanding.set(key, ok);
  }
  return ok;
}

/**
 * A place an item can be dropped. While a drag is on, zones the item could go to get a
 * faint fill and the one under the pointer a stronger one; the rest stay as they are.
 * Zones nest: a slot row that takes the item handles the drop, otherwise it falls
 * through to the character's column around it.
 */
export function DropZone({
  to,
  bucket,
  column = false,
  label,
  className,
  style,
  children,
}: {
  to: Landing;
  /** Only items of this bucket (a slot row); omit to take any movable item. */
  bucket?: number;
  /** A character's whole column: tinted over its content, only while under the pointer. */
  column?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const actions = useManagerActions();
  const drag = useStoreValue(dragStore);
  const dropCharacter = useStoreValue(characterDropStore);
  const [over, setOver] = useState(false);
  const accepts =
    drag !== null &&
    actions !== null &&
    (bucket === undefined || drag.item.bucketHash === bucket) &&
    canLand(actions, drag, to);
  const inventoryOf = to.kind === "character" && !to.equipped ? to.characterId : undefined;
  // The item's own slot row on the character whose column it's being dropped on.
  const landing = accepts && bucket !== undefined && inventoryOf === dropCharacter;

  const tint = !accepts
    ? undefined
    : column
      ? over && "bg-foreground/10"
      : over || landing
        ? "bg-foreground/15"
        : "bg-foreground/5";
  return (
    <div
      aria-label={label}
      className={cn("transition-colors duration-100", column ? "relative" : tint, className)}
      style={style}
      onDragOver={(e) => {
        if (!accepts) return;
        setOver(true);
        // A slot row inside already took it: the column only shows it's the target.
        const direct = e.defaultPrevented;
        if (column) characterDropStore.set(direct ? null : (inventoryOf ?? null));
        if (direct) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        if (column && characterDropStore.get() === inventoryOf) characterDropStore.set(null);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!accepts || !actions || e.defaultPrevented) return;
        e.preventDefault();
        actions.move(drag.item, drag.place, to);
        actions.dragEnd();
      }}
    >
      {children}
      {column && tint && (
        <span aria-hidden className={cn("pointer-events-none absolute inset-0 z-20", tint)} />
      )}
    </div>
  );
}
