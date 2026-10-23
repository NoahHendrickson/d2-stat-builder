// Where every vault tile goes, worked out from the pane's width, so the manager can
// mount only the lines on screen: a full vault is 700+ tiles, each one images and store
// subscriptions. Tiles are a fixed size, which lets this reproduce what CSS flow would
// do: a bucket's groups stack one per line (grouped by type) or sit side by side and
// wrap, and a group wider than the pane wraps its own tiles.
import type { InventoryItem } from "./build";
import type { GroupKey, ItemGroup, TileSize } from "./view-settings";

/** A large tile: a 1px frame round a 58px icon over its 16px label bar. */
export const TILE_WIDTH_PX = 60;
export const TILE_HEIGHT_PX = 76;
/** Between tiles, across and down. */
export const TILE_GAP_PX = 8;
/** Between a group's marker and its tiles. */
export const MARKER_GAP_PX = 12;
/** Between groups side by side, and between one group's lines and the next's. */
export const GROUP_GAP_X_PX = 20;
const GROUP_GAP_Y_PX = 16;
/** Above and below a bucket's tiles, unless the caller asks for other padding. */
const BUCKET_PAD_PX = 10;
/** A section heading: 20px above one 16px label line, 4px below. */
export const HEADING_HEIGHT_PX = 40;

/** A line naming what follows on phones: a slot ("Kinetic") or a group ("Hand Cannon"). */
export const CAPTION_HEIGHT_PX = 28;

/**
 * Tile size and spacing to lay out with. Desktop tiles are the size picked in the Items
 * settings; phones size them to fit.
 */
export interface TileMetrics {
  tile: number;
  /** Tile plus its label bar. */
  height: number;
  gap: number;
  /** Tiles across a full line (phones only; desktop lines just wrap). */
  cols: number;
}

/** The label bar under the icon, the same height at every tile size. */
const TILE_FOOTER_PX = TILE_HEIGHT_PX - TILE_WIDTH_PX;

const desktopTiles = (tile: number, gap: number): TileMetrics => ({
  tile,
  height: tile + TILE_FOOTER_PX,
  gap,
  cols: 0,
});

/**
 * Each desktop tile size: the tile's width (frame included) and the gap between tiles. One
 * object per size, so memoized layouts and tile lines keep them across renders.
 */
const DESKTOP_TILES: Record<TileSize, TileMetrics> = {
  large: desktopTiles(TILE_WIDTH_PX, TILE_GAP_PX),
  medium: desktopTiles(52, 6),
  small: desktopTiles(44, 6),
};

export const desktopTileMetrics = (size: TileSize): TileMetrics => DESKTOP_TILES[size];

export const DESKTOP_TILE_METRICS: TileMetrics = DESKTOP_TILES.large;

const PHONE_TILE_GAP_PX = 6;
const PHONE_MIN_COLS = 6;

/**
 * Phones: at least six tiles across, as wide as fills `width` in whole columns but never
 * wider than a desktop tile. A character slot row is the equipped tile, a double gap, then
 * `cols - 1` more, so the tile leaves room for one gap per column.
 */
export function phoneTileMetrics(width: number): TileMetrics {
  const gap = PHONE_TILE_GAP_PX;
  const cols = Math.max(PHONE_MIN_COLS, Math.ceil((width + gap) / (TILE_WIDTH_PX + gap)));
  const tile = Math.max(1, Math.floor((width - cols * gap) / cols));
  return { tile, height: tile + TILE_FOOTER_PX, gap, cols };
}

/** One vault row (a slot's items, sorted and grouped) to lay out. */
export interface VaultBucket {
  /** Unique among the buckets laid out together. */
  key: string;
  /** "Kinetic", "Helmet", …: names the bucket's lines for assistive tech. */
  label?: string;
  groupBy: GroupKey;
  groups: readonly ItemGroup[];
  /** One group per line, rather than side by side. */
  stacked: boolean;
  /** Width of the marker drawn beside a group's tiles, or 0 when it has none. */
  markerWidth(group: ItemGroup): number;
  /**
   * Phones: name the bucket and each of its groups on a line of their own above their
   * tiles. Pair with `stacked` and no markers, so each group starts its own line.
   */
  captions?: boolean;
}

export interface VaultSection {
  /** Drawn above the section's buckets; none when the buckets sit beside what names them. */
  heading?: string;
  buckets: readonly VaultBucket[];
}

/** One group's tiles on a line. */
export interface VaultCell {
  key: string;
  /** Column kept before the tiles for the group's marker (0: none), on all its lines. */
  markerWidth: number;
  /** The item the marker is drawn from; set on the group's first line only. */
  marker?: InventoryItem;
  items: readonly InventoryItem[];
}

interface LineBox {
  key: string;
  /** Offset from the top of the list. */
  top: number;
  /** Includes the padding above (and, on a bucket's last line, below) the tiles. */
  height: number;
}

export interface VaultHeadingLine extends LineBox {
  kind: "heading";
  label: string;
}

export interface VaultTileLine extends LineBox {
  kind: "tiles";
  label?: string;
  groupBy: GroupKey;
  /** Space above the tiles: the gap from the line before. */
  padTop: number;
  cells: readonly VaultCell[];
}

export interface VaultCaptionLine extends LineBox {
  kind: "caption";
  /** A bucket's name, or one of its groups'. */
  level: "bucket" | "group";
  label: string;
  /** Items in the group (or bucket). */
  count: number;
}

export type VaultLine = VaultHeadingLine | VaultTileLine | VaultCaptionLine;

export interface VaultLayout {
  lines: VaultLine[];
  height: number;
}

interface BucketRow {
  key: string;
  cells: VaultCell[];
  /** Starts a group (or a line of small groups): set apart from the line above. */
  opens: boolean;
  /** Phones: the group this row starts, named on a line above it. */
  caption?: { label: string; count: number };
}

/** A bucket's tiles as rows: which groups, and which of their items, share each one. */
function bucketRows(bucket: VaultBucket, width: number, m: TileMetrics): BucketRow[] {
  const pitch = m.tile + m.gap;
  const rows: BucketRow[] = [];
  // Small groups waiting to share a row, and the width they take so far.
  let shared: VaultCell[] = [];
  let used = 0;
  const flush = () => {
    if (shared.length > 0) rows.push({ key: `${bucket.key}:${shared[0]!.key}:0`, cells: shared, opens: true });
    shared = [];
    used = 0;
  };

  for (const group of bucket.groups) {
    if (group.items.length === 0) continue;
    const markerWidth = bucket.markerWidth(group);
    const lead = markerWidth > 0 ? markerWidth + MARKER_GAP_PX : 0;
    const natural = lead + group.items.length * pitch - m.gap;

    if (!bucket.stacked && natural <= width) {
      if (shared.length > 0 && used + GROUP_GAP_X_PX + natural > width) flush();
      used += (shared.length > 0 ? GROUP_GAP_X_PX : 0) + natural;
      shared.push({ key: group.key, markerWidth, marker: group.items[0], items: group.items });
      continue;
    }

    // A line (or several) of its own, wrapping at the pane's edge.
    flush();
    const perRow = Math.max(1, Math.floor((width - lead + m.gap) / pitch));
    for (let i = 0; i < group.items.length; i += perRow) {
      rows.push({
        key: `${bucket.key}:${group.key}:${i / perRow}`,
        cells: [
          {
            key: group.key,
            markerWidth,
            ...(i === 0 ? { marker: group.items[0] } : {}),
            items: group.items.slice(i, i + perRow),
          },
        ],
        opens: i === 0,
        ...(i === 0 && bucket.captions && group.label
          ? { caption: { label: group.label, count: group.items.length } }
          : {}),
      });
    }
  }
  flush();
  return rows;
}

/**
 * Every section's heading and tile lines, top to bottom, for a pane `width` px wide of
 * `m`'s tiles, with `pad` px above and below each bucket's tiles. Nothing is left out: each item is
 * in exactly one cell. An unmeasured pane (width 0) has no lines yet.
 */
export function layoutVault(
  sections: readonly VaultSection[],
  width: number,
  m: TileMetrics,
  pad = BUCKET_PAD_PX,
): VaultLayout {
  const lines: VaultLine[] = [];
  if (width <= 0) return { lines, height: 0 };
  let top = 0;

  for (const section of sections) {
    if (section.heading !== undefined) {
      lines.push({
        kind: "heading",
        key: `heading:${section.heading}`,
        label: section.heading,
        top,
        height: HEADING_HEIGHT_PX,
      });
      top += HEADING_HEIGHT_PX;
    }

    for (const bucket of section.buckets) {
      const rows = bucketRows(bucket, width, m);
      // Tiles sit right under a caption (its line has room above the text); otherwise
      // they're padded as usual.
      let captioned = false;
      const pushCaption = (key: string, level: VaultCaptionLine["level"], label: string, count: number) => {
        lines.push({ kind: "caption", key, level, label, count, top, height: CAPTION_HEIGHT_PX });
        top += CAPTION_HEIGHT_PX;
        captioned = true;
      };
      if (bucket.captions && bucket.label && rows.length > 0) {
        const count = bucket.groups.reduce((n, g) => n + g.items.length, 0);
        pushCaption(`${bucket.key}:caption`, "bucket", bucket.label, count);
      }
      rows.forEach((row, i) => {
        if (row.caption) pushCaption(`${row.key}:caption`, "group", row.caption.label, row.caption.count);
        const padTop = captioned ? 0 : i === 0 ? pad : row.opens ? GROUP_GAP_Y_PX : m.gap;
        captioned = false;
        const height = padTop + m.height + (i === rows.length - 1 ? pad : 0);
        lines.push({
          kind: "tiles",
          key: row.key,
          ...(bucket.label ? { label: bucket.label } : {}),
          groupBy: bucket.groupBy,
          top,
          height,
          padTop,
          cells: row.cells,
        });
        top += height;
      });
    }
  }
  return { lines, height: top };
}


/** The lines overlapping `from`…`to` (list offsets), as a half-open index range. */
export function linesBetween(lines: readonly VaultLine[], from: number, to: number): [number, number] {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.top + lines[mid]!.height <= from) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.top < to) lo = mid + 1;
    else hi = mid;
  }
  return [start, lo];
}

/** Index of the line holding the item, or -1. */
export function lineOfItem(lines: readonly VaultLine[], itemKey: string): number {
  return lines.findIndex(
    (line) => line.kind === "tiles" && line.cells.some((cell) => cell.items.some((item) => item.key === itemKey)),
  );
}
