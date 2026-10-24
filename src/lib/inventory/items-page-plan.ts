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

/**
 * Character rows: the narrowest the nameplate strip across a row goes. Measured: the
 * emblem (64px), six three-digit stats, the champions, and Power over Max (556px), two set
 * bonuses (80px), and about 100px left for the class name. Large rows are wider anyway;
 * smaller tiles' rows widen to it.
 */
export const ROW_STRIP_MIN_PX = 800;

/** How wide a character row is with `m`'s tiles: the strip, or the gear under it. */
export const characterRowWidth = (m: TileMetrics) =>
  Math.max(
    ROW_STRIP_MIN_PX,
    rowInfoWidth(m) +
      ROW_COLUMN_GAP_PX +
      2 * (zoneWidth(ROW_INVENTORY_COLUMNS, m) + zoneWidth(1, m)) +
      ROW_MIDDLE_PX +
      4 * m.gap,
  );

/** Between the characters and the vault beside them (gap-6). */
const LAYOUT_GAP_PX = 24;
/** The vault goes beside the character rows only with room for five tiles across. */
const vaultBesideMinWidth = (m: TileMetrics) => 5 * m.tile + 4 * m.gap;
/**
 * Legacy columns: the narrowest a nameplate's stats line goes (six 14px glyphs and
 * three-digit values), measured, which holds the column open once its tiles are smaller.
 * A wider plate only costs the vault (it takes what's left), never clips anything.
 */
const COLUMN_PLATE_MIN_PX = 230;
/** Legacy columns: a character column, its nameplate or its slot rows (the equipped tile then three more). */
const columnWidth = (m: TileMetrics) =>
  Math.max(COLUMN_PLATE_MIN_PX, zoneWidth(1, m) + m.gap + zoneWidth(ROW_INVENTORY_COLUMNS, m));
/** Legacy columns: the padding between columns side by side (px-4 each side). */
const COLUMNS_GAP_PX = 2 * 16;
/** Legacy columns: after the one column shown under tabs, before the aligned vault (pr-3). */
const COMPACT_COLUMN_PAD_PX = 12;

/**
 * The room the vault keeps beside the character columns, given in px at Large and scaled
 * by the tile pitch, so every size keeps about as many vault tiles across.
 */
const vaultRoom = (largePx: number, m: TileMetrics) =>
  Math.round(
    (largePx * (m.tile + m.gap)) / (DESKTOP_TILE_METRICS.tile + DESKTOP_TILE_METRICS.gap),
  );
/** Beside all three columns: about ten Large tiles across (1580px wide at Large). */
const ALL_CHARACTERS_VAULT_ROOM_LARGE_PX = 676;
/** Aligned beside one column: about seven Large tiles across (760px wide at Large). */
const ALIGNED_VAULT_ROOM_LARGE_PX = 468;

/**
 * Legacy columns: below this width, three character columns would leave the vault only a
 * handful of tiles across, so it shows one character at a time.
 */
const columnsAllCharactersMinWidth = (m: TileMetrics) =>
  3 * columnWidth(m) + 2 * COLUMNS_GAP_PX + vaultRoom(ALL_CHARACTERS_VAULT_ROOM_LARGE_PX, m);
/**
 * Legacy columns: from this width the vault sits beside the characters, each of its slots
 * on the same row as that slot on the characters. Narrower, it goes below them.
 */
const columnsAlignedMinWidth = (m: TileMetrics) =>
  columnWidth(m) + COMPACT_COLUMN_PAD_PX + vaultRoom(ALIGNED_VAULT_ROOM_LARGE_PX, m);

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
  tiles,
}: {
  phone: boolean;
  layout: ItemsLayout;
  width: number;
  tiles: TileMetrics;
}): ItemsPagePlan | null {
  if (phone) return { kind: "phone" };
  if (width <= 0) return null;
  if (layout === "legacy") {
    return {
      kind: "columns",
      compact: width < columnsAllCharactersMinWidth(tiles),
      vault: width >= columnsAlignedMinWidth(tiles) ? "aligned" : "below",
    };
  }
  const row = characterRowWidth(tiles);
  if (row + LAYOUT_GAP_PX + vaultBesideMinWidth(tiles) <= width) {
    return { kind: "rows", vault: "beside" };
  }
  if (row <= width) return { kind: "rows", vault: "below" };
  return { kind: "columns", compact: true, vault: "below" };
}
