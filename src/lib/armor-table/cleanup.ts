// The /armor Cleanup view: the pieces the optimizer rarely or never reaches for,
// grouped by class and slot, least used first, so deciding what to delete is one pass
// down the list.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import { ARMOR_SLOTS, type ArmorSlot } from "../armory/stats";
import type { PieceUsageCounts, UsageBucket } from "../build-usage/buckets";

/** The usage ratings Cleanup can show; "often" and unrated pieces never qualify. */
export const CLEANUP_TIERS = ["never", "rarely", "sometimes"] as const satisfies readonly UsageBucket[];
export type CleanupTier = (typeof CLEANUP_TIERS)[number];
export const DEFAULT_CLEANUP_TIERS: readonly CleanupTier[] = ["never", "rarely"];

export interface CleanupRow {
  piece: { classType: number; slot: ArmorSlot };
  usage?: PieceUsageCounts;
  usageBucket: UsageBucket;
}

export interface CleanupGroups<R> {
  /** Only pieces in the chosen tiers, each class + slot contiguous. */
  rows: R[];
  /** Per entry of `rows`: its group's index, and whether it opens the group. */
  groups: { index: number; first: boolean }[];
  groupCount: number;
}

const share = (u: PieceUsageCounts | undefined) => (u && u.eligible > 0 ? u.used / u.eligible : 0);

/**
 * Keeps the rows rated in `tiers`, grouped Titan → Hunter → Warlock, helmet → class
 * item. Within a group the least used come first (lowest share of searches, then the
 * most searches seen, the surest), and the table's own order breaks what's left.
 */
export function groupCleanup<R extends CleanupRow>(
  rows: readonly R[],
  tiers: readonly CleanupTier[],
): CleanupGroups<R> {
  const wanted = new Set<UsageBucket>(tiers);
  const byGroup = new Map<string, R[]>();
  for (const row of rows) {
    if (!wanted.has(row.usageBucket)) continue;
    const key = `${row.piece.classType}|${ARMOR_SLOTS.indexOf(row.piece.slot)}`;
    const members = byGroup.get(key);
    if (members) members.push(row);
    else byGroup.set(key, [row]);
  }
  const keys = [...byGroup.keys()].sort((a, b) => {
    const [ca, sa] = a.split("|").map(Number);
    const [cb, sb] = b.split("|").map(Number);
    return ca - cb || sa - sb;
  });
  const out: CleanupGroups<R> = { rows: [], groups: [], groupCount: 0 };
  for (const key of keys) {
    const members = byGroup
      .get(key)!
      .map((row, order) => ({ row, order }))
      .sort(
        (a, b) =>
          share(a.row.usage) - share(b.row.usage) ||
          (b.row.usage?.eligible ?? 0) - (a.row.usage?.eligible ?? 0) ||
          a.order - b.order,
      );
    const index = out.groupCount++;
    members.forEach(({ row }, i) => {
      out.rows.push(row);
      out.groups.push({ index, first: i === 0 });
    });
  }
  return out;
}
