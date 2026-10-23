import { DESKTOP_TILE_METRICS, type TileMetrics } from "./vault-layout";
import type { ItemsLayout } from "./view-settings";

/** Character rows: the postmaster column, four postmaster tiles across. */
export const rowInfoWidth = (m: TileMetrics) => 4 * m.tile + 3 * m.gap;
/** Character rows: between the postmaster column and the gear. */
export const ROW_COLUMN_GAP_PX = 16;
/** Character rows: between the weapons and the armor, where the game draws the Guardian. */
export const ROW_MIDDLE_PX = 24;
/** A drop zone's padding round its tiles (p-1). */
export const ZONE_PAD_PX = 4;
/** Character rows: a slot's unequipped items sit in a 3×3 grid, as in the game. */
export const ROW_INVENTORY_COLUMNS = 3;

/** A drop zone `tiles` tiles wide, padding included. */
export const zoneWidth = (tiles: number, m: TileMetrics) =>
  tiles * m.tile + (tiles - 1) * m.gap + 2 * ZONE_PAD_PX;

/** How wide a character row is with `m`'s tiles. */
export const characterRowWidth = (m: TileMetrics) =>
  rowInfoWidth(m) +
  ROW_COLUMN_GAP_PX +
  2 * (zoneWidth(ROW_INVENTORY_COLUMNS, m) + zoneWidth(1, m)) +
  ROW_MIDDLE_PX +
  4 * m.gap;

/** Between the characters and the vault beside them (gap-6). */
const LAYOUT_GAP_PX = 24;
/** The vault goes beside the character rows only with room for five tiles across. */
const vaultBesideMinWidth = (m: TileMetrics) => 5 * m.tile + 4 * m.gap;
/** Legacy columns: a character column's slot row, the equipped tile then three more. */
const columnWidth = (m: TileMetrics) => zoneWidth(1, m) + m.gap + zoneWidth(ROW_INVENTORY_COLUMNS, m);
/**
 * Legacy columns: below this width, three character columns (about 930px with large tiles)
 * would leave the vault only a handful of tiles across, so it shows one character at a
 * time. Smaller tiles leave the vault the same room.
 */
const columnsAllCharactersMinWidth = (m: TileMetrics) =>
  1580 - 3 * (columnWidth(DESKTOP_TILE_METRICS) - columnWidth(m));
/**
 * Legacy columns: from this width the vault sits beside the characters, each of its slots
 * on the same row as that slot on the characters. Narrower, it goes below them.
 */
const COLUMNS_ALIGNED_MIN_PX = 760;

/**
 * What the Items page draws:
 * - `rows`: a row per character (CharacterRows), the vault in its own pane beside them or
 *   below them.
 * - `columns`: character columns (InventoryGrid), every one side by side or (compact) one
 *   at a time under tabs, the vault one more column level with their slots (aligned) or
 *   below them. The legacy layout, and the new one's fallback when a row doesn't fit.
 * - `phone`: one character at a time under tabs, the vault behind a tab of its own.
 */
export type ItemsPagePlan =
  | { kind: "rows"; vault: "beside" | "below" }
  | { kind: "columns"; compact: boolean; vault: "aligned" | "below" }
  | { kind: "phone" };

/**
 * The page's layout for the picked `layout` at `width` (the layout box's, in px), with
 * `tiles` (desktop tiles at the picked size). Null until a wider screen has been measured:
 * nothing should mount on a guess.
 */
export function itemsPagePlan({
  phone,
  layout,
  width,
  tiles = DESKTOP_TILE_METRICS,
}: {
  phone: boolean;
  layout: ItemsLayout;
  width: number;
  tiles?: TileMetrics;
}): ItemsPagePlan | null {
  if (phone) return { kind: "phone" };
  if (width <= 0) return null;
  if (layout === "legacy") {
    return {
      kind: "columns",
      compact: width < columnsAllCharactersMinWidth(tiles),
      vault: width >= COLUMNS_ALIGNED_MIN_PX ? "aligned" : "below",
    };
  }
  const row = characterRowWidth(tiles);
  if (row + LAYOUT_GAP_PX + vaultBesideMinWidth(tiles) <= width) {
    return { kind: "rows", vault: "beside" };
  }
  if (row <= width) return { kind: "rows", vault: "below" };
  return { kind: "columns", compact: true, vault: "below" };
}
