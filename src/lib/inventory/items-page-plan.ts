import { TILE_GAP_PX, TILE_WIDTH_PX } from "./vault-layout";
import type { ItemsLayout } from "./view-settings";

/** Character rows: the postmaster column, four postmaster tiles across. */
export const ROW_INFO_PX = 4 * TILE_WIDTH_PX + 3 * TILE_GAP_PX;
/** Character rows: between the postmaster column and the gear. */
export const ROW_COLUMN_GAP_PX = 16;
/** Character rows: between the weapons and the armor, where the game draws the Guardian. */
export const ROW_MIDDLE_PX = 24;
/** A drop zone's padding round its tiles (p-1). */
export const ZONE_PAD_PX = 4;
/** Character rows: a slot's unequipped items sit in a 3×3 grid, as in the game. */
export const ROW_INVENTORY_COLUMNS = 3;

/** A drop zone `tiles` tiles wide, padding included. */
export const zoneWidth = (tiles: number) =>
  tiles * TILE_WIDTH_PX + (tiles - 1) * TILE_GAP_PX + 2 * ZONE_PAD_PX;

/** How wide a character row is. */
export const CHARACTER_ROW_PX =
  ROW_INFO_PX +
  ROW_COLUMN_GAP_PX +
  2 * (zoneWidth(ROW_INVENTORY_COLUMNS) + zoneWidth(1)) +
  ROW_MIDDLE_PX +
  4 * TILE_GAP_PX;

/** Between the characters and the vault beside them (gap-6). */
const LAYOUT_GAP_PX = 24;
/** The vault goes beside the character rows only with room for five tiles across. */
const VAULT_BESIDE_MIN_PX = 5 * TILE_WIDTH_PX + 4 * TILE_GAP_PX;
/**
 * Legacy columns: below this width, three character columns (about 930px) would leave the
 * vault only a handful of tiles across, so it shows one character at a time.
 */
const COLUMNS_ALL_CHARACTERS_MIN_PX = 1580;
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
 * The page's layout for the picked `layout` at `width` (the layout box's, in px). Null
 * until a wider screen has been measured: nothing should mount on a guess.
 */
export function itemsPagePlan({
  phone,
  layout,
  width,
}: {
  phone: boolean;
  layout: ItemsLayout;
  width: number;
}): ItemsPagePlan | null {
  if (phone) return { kind: "phone" };
  if (width <= 0) return null;
  if (layout === "legacy") {
    return {
      kind: "columns",
      compact: width < COLUMNS_ALL_CHARACTERS_MIN_PX,
      vault: width >= COLUMNS_ALIGNED_MIN_PX ? "aligned" : "below",
    };
  }
  if (CHARACTER_ROW_PX + LAYOUT_GAP_PX + VAULT_BESIDE_MIN_PX <= width) {
    return { kind: "rows", vault: "beside" };
  }
  if (CHARACTER_ROW_PX <= width) return { kind: "rows", vault: "below" };
  return { kind: "columns", compact: true, vault: "below" };
}
