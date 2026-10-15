"use client";

import { createContext, useContext } from "react";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import type { Landing, Place } from "@/lib/inventory/moves";
import type { MoveStep } from "@/lib/inventory/smart-moves";
import type { MoveOutcome } from "@/lib/inventory/move-queue";
import type { PendingToast } from "@/lib/toast";
import { createValueStore } from "@/lib/value-store";
import type { TileMetrics } from "@/lib/inventory/vault-layout";

/** The item being dragged and where it came from; drop zones subscribe to this. */
export interface DragInfo {
  item: InventoryItem;
  place: Place;
}
export const dragStore = createValueStore<DragInfo | null>(null);

/**
 * What tiles and drop zones can do. Stable for the page's life (it reads the latest
 * inventory through `inventory()`), so memoized tiles never re-render because of it.
 */
export interface ManagerActions {
  inventory(): ManagerInventory;
  /** Open the move menu for a tile. */
  open(item: InventoryItem, anchor: HTMLElement): void;
  /** Start dragging; false cancels (equipped, account-wide, or not movable). */
  dragStart(item: InventoryItem): boolean;
  dragEnd(): void;
  /** Why `item` can't get to `to` even with smart moves, or null when it can. */
  problem(item: InventoryItem, place: Place, to: Landing): string | null;
  /** Move it, making room first when needed (smart moves). */
  move(item: InventoryItem, place: Place, to: Landing): void;
  /**
   * Queue already-planned steps (bulk moves plan against their own running state). They
   * get their own toast unless `notify` says otherwise.
   */
  runSteps(steps: readonly MoveStep[], notify?: PendingToast | false): Promise<MoveOutcome>;
  /** Equip on the character played last (double-click). */
  quickEquip(item: InventoryItem): void;
  /** Lock or unlock items (those already in that state are skipped). */
  lock(items: readonly InventoryItem[], locked: boolean): void;
  /** Open Compare for every copy of this weapon. */
  compare(item: InventoryItem): void;
}

export const ManagerActionsContext = createContext<ManagerActions | null>(null);

export function useManagerActions(): ManagerActions | null {
  return useContext(ManagerActionsContext);
}

/**
 * Whether the page is laid out for a phone (below Tailwind `md`), and there, the tile
 * size and spacing that fill its width (see phoneTileMetrics). Wider screens keep fixed
 * 60px tiles.
 */
export type ManagerLayout = { phone: false } | { phone: true; tiles: TileMetrics };

export const ManagerLayoutContext = createContext<ManagerLayout>({ phone: false });

export function usePhoneLayout(): boolean {
  return useContext(ManagerLayoutContext).phone;
}

/** Phones: the tile size that fills the page's width. Null on wider screens. */
export function usePhoneTiles(): TileMetrics | null {
  const layout = useContext(ManagerLayoutContext);
  return layout.phone ? layout.tiles : null;
}

/**
 * The classes for a column's nameplate block (a character's, the vault's): pinned under the
 * search bar, filled once something scrolls under it. pt-3 is that filled gap; -mt-3 keeps it
 * out of the layout. Phones pin the tab strip instead: a nameplate there would take a fifth of
 * the screen.
 */
export function usePinnedPlateClass(): string {
  return usePhoneLayout()
    ? "pb-3"
    : "sticky top-8 z-10 -mt-3 py-3 group-data-scrolled/manager:d2-sticky-fill";
}
