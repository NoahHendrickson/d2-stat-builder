// Where every vault tile goes, worked out from the pane's width, so the manager can
// mount only the lines on screen: a full vault is 700+ tiles, each one images and store
// subscriptions. Tiles are a fixed size, which lets this reproduce what CSS flow would
// do: a bucket's groups stack one per line (grouped by type) or sit side by side and
// wrap, and a group wider than the pane wraps its own tiles.
import type { InventoryItem } from "./build";
import type { GroupKey, ItemGroup } from "./view-settings";

/** A tile: a 1px frame round a 54px icon over its 16px label bar. */
export const TILE_WIDTH_PX = 56;
export const TILE_HEIGHT_PX = 72;
/** Between tiles, across and down. */
export const TILE_GAP_PX = 6;
/** Between a group's marker and its tiles. */
export const MARKER_GAP_PX = 12;
/** Between groups side by side, and between one group's lines and the next's. */
export const GROUP_GAP_X_PX = 20;
const GROUP_GAP_Y_PX = 16;
/** Above and below a bucket's tiles. */
const BUCKET_PAD_PX = 10;
/** A section heading: 20px above one 16px label line, 4px below. */
export const HEADING_HEIGHT_PX = 40;

const TILE_PITCH_PX = TILE_WIDTH_PX + TILE_GAP_PX;

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
}

export interface VaultSection {
  heading: string;
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

export type VaultLine = VaultHeadingLine | VaultTileLine;

export interface VaultLayout {
  lines: VaultLine[];
  height: number;
}

interface BucketRow {
  key: string;
  cells: VaultCell[];
  /** Starts a group (or a line of small groups): set apart from the line above. */
  opens: boolean;
}

/** A bucket's tiles as rows: which groups, and which of their items, share each one. */
function bucketRows(bucket: VaultBucket, width: number): BucketRow[] {
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
    const natural = lead + group.items.length * TILE_PITCH_PX - TILE_GAP_PX;

    if (!bucket.stacked && natural <= width) {
      if (shared.length > 0 && used + GROUP_GAP_X_PX + natural > width) flush();
      used += (shared.length > 0 ? GROUP_GAP_X_PX : 0) + natural;
      shared.push({ key: group.key, markerWidth, marker: group.items[0], items: group.items });
      continue;
    }

    // A line (or several) of its own, wrapping at the pane's edge.
    flush();
    const perRow = Math.max(1, Math.floor((width - lead + TILE_GAP_PX) / TILE_PITCH_PX));
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
      });
    }
  }
  flush();
  return rows;
}

/**
 * Every section's heading and tile lines, top to bottom, for a pane `width` px wide.
 * Nothing is left out: each item is in exactly one cell. An unmeasured pane (width 0)
 * has no lines yet.
 */
export function layoutVault(sections: readonly VaultSection[], width: number): VaultLayout {
  const lines: VaultLine[] = [];
  if (width <= 0) return { lines, height: 0 };
  let top = 0;

  for (const section of sections) {
    lines.push({
      kind: "heading",
      key: `heading:${section.heading}`,
      label: section.heading,
      top,
      height: HEADING_HEIGHT_PX,
    });
    top += HEADING_HEIGHT_PX;

    for (const bucket of section.buckets) {
      const rows = bucketRows(bucket, width);
      rows.forEach((row, i) => {
        const padTop = i === 0 ? BUCKET_PAD_PX : row.opens ? GROUP_GAP_Y_PX : TILE_GAP_PX;
        const height = padTop + TILE_HEIGHT_PX + (i === rows.length - 1 ? BUCKET_PAD_PX : 0);
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
