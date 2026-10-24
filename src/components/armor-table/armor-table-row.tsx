"use client";

import { memo } from "react";
import { armorPipTier, type ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_ORDER,
} from "@/lib/armory/stats";
import { statLabel } from "@/lib/armor-table/sort";
import { Badge } from "@/components/ui/badge";
import { ArmorRowActions } from "@/components/armor-table/armor-row-actions";
import { ArmorThumb } from "@/components/armor-thumb";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { useAnnotation } from "@/lib/inventory/annotations";
import {
  usageTitle,
  type PieceUsageCounts,
  type UsageBucket,
} from "@/lib/build-usage/buckets";
import { BUILD_USAGE_PAUSED } from "@/lib/build-usage/paused";
import { cn } from "@/lib/utils";

export const COLUMN_COUNT = BUILD_USAGE_PAUSED ? 12 : 13;

/** Column widths: name is capped (with room for the row actions that show on hover);
 *  Class→Set share leftover so wide screens don't leave a huge empty gap after the
 *  piece name. Stats stay fixed. */
export const TABLE_COLGROUP = (
  <colgroup>
    {/* Phones: narrower, and pinned (see NAME_CELL_STICKY), so stats scroll in beside it. */}
    <col className="w-[22rem] max-md:w-[13rem]" /* name */ />
    <col /* class — flexible */ />
    <col /* archetype — flexible */ />
    <col /* tertiary — flexible */ />
    <col /* tuned — flexible */ />
    <col /* set — flexible */ />
    {!BUILD_USAGE_PAUSED && <col style={{ width: "5.5rem" }} /* searches */ />}
    {STAT_DISPLAY_ORDER.map((key) => (
      <col key={key} style={{ width: "3.25rem" }} />
    ))}
  </colgroup>
);

/**
 * Duplicate groups cycle these hues (amber first) so neighbouring groups never share
 * a colour. Written out whole for Tailwind: background (plus `--row-tint`, the same wash for
 * the opaque sticky name cell on phones), hover, and the line that opens the group, then the
 * faint line between its rows.
 */
const DUPLICATE_GROUP_TINTS = [
  ["bg-amber-500/14 hover:bg-amber-500/24 [--row-tint:color-mix(in_oklab,var(--color-amber-500)_14%,transparent)]", "border-amber-500/60", "border-amber-500/15"],
  ["bg-sky-500/14 hover:bg-sky-500/24 [--row-tint:color-mix(in_oklab,var(--color-sky-500)_14%,transparent)]", "border-sky-500/60", "border-sky-500/15"],
  ["bg-emerald-500/14 hover:bg-emerald-500/24 [--row-tint:color-mix(in_oklab,var(--color-emerald-500)_14%,transparent)]", "border-emerald-500/60", "border-emerald-500/15"],
  ["bg-rose-500/14 hover:bg-rose-500/24 [--row-tint:color-mix(in_oklab,var(--color-rose-500)_14%,transparent)]", "border-rose-500/60", "border-rose-500/15"],
  ["bg-violet-500/14 hover:bg-violet-500/24 [--row-tint:color-mix(in_oklab,var(--color-violet-500)_14%,transparent)]", "border-violet-500/60", "border-violet-500/15"],
  ["bg-lime-500/14 hover:bg-lime-500/24 [--row-tint:color-mix(in_oklab,var(--color-lime-500)_14%,transparent)]", "border-lime-500/60", "border-lime-500/15"],
] as const;

/**
 * Phones: the name cell stays put while the table scrolls sideways. Sticky cells need a
 * solid fill, so it paints the opaque glass under the row's duplicate tint, if any.
 */
const NAME_CELL_STICKY =
  "max-md:sticky max-md:left-0 max-md:z-[1] max-md:pr-1 max-md:shadow-[1px_0_0_var(--border)] max-md:[background:linear-gradient(var(--row-tint,transparent),var(--row-tint,transparent)),var(--glass-opaque)]";

export interface Row {
  piece: ArmorPiece;
  setName?: string;
  /** Tertiary archetype stat index — Armor 3.0 pieces only. */
  tertiary?: number;
  /** `normalizeSearchText(piece.name)` — computed once with the row. */
  searchName: string;
  /** Optimizer usage history; absent until a recorded query included the piece. */
  usage?: PieceUsageCounts;
  /** In a saved loadout: rated "often" whatever its count. */
  inLoadout: boolean;
  usageBucket: UsageBucket;
}

export const ArmorRow = memo(function ArmorRow({
  row,
  characters,
  onRefresh,
  dataIndex,
  measureRef,
  provisional = false,
  group,
}: {
  row: Row;
  characters: ArmoryCharacter[];
  onRefresh: () => void;
  dataIndex: number;
  /** Last visit's gear is on screen; row actions wait for the live profile. */
  provisional?: boolean;
  measureRef: (el: HTMLTableRowElement | null) => void;
  /** Its duplicate group, when the table shows duplicates: tinted by `DUPLICATE_GROUP_TINTS`. */
  group?: { index: number; first: boolean };
}) {
  const { piece } = row;
  const tag = useAnnotation(piece.instanceId)?.tag;
  const junk = tag === "junk";
  const tint = group && DUPLICATE_GROUP_TINTS[group.index % DUPLICATE_GROUP_TINTS.length];
  return (
    <tr
      ref={measureRef}
      data-index={dataIndex}
      className={cn(
        "group/row border-t",
        group && tint
          ? cn(tint[0], group.first && dataIndex > 0 ? tint[1] : tint[2])
          : "border-foreground/8 hover:bg-foreground/6",
        // Junk fades everything but the row actions, which stay clickable.
        junk && "[&>td:not(:first-child)]:opacity-40",
      )}
    >
      <td className={cn("overflow-hidden py-2 pr-3 pl-3", NAME_CELL_STICKY)}>
        <div className="flex items-center gap-2">
          <div className={cn("flex min-w-0 flex-1 items-center gap-2", junk && "opacity-40")}>
            {piece.icon ? (
              <ArmorThumb
                icon={piece.icon}
                watermark={piece.watermark}
                size={32}
                masterworked={isFullyMasterworked(piece)}
                gearTier={armorPipTier(piece)}
              />
            ) : (
              <span className="d2-brackets bg-black/25 size-8 shrink-0" aria-hidden />
            )}
            <span className="truncate text-sm">{piece.name}</span>
            {piece.isArtifice && (
              <Badge variant="outline">
                Artifice
              </Badge>
            )}
          </div>
          <ArmorRowActions
            piece={piece}
            characters={characters}
            onDone={onRefresh}
            provisional={provisional}
            tag={tag}
          />
        </div>
      </td>
      <td className="truncate py-2 pr-3 text-sm">{CLASS_NAMES[piece.classType] ?? "—"}</td>
      <td className="truncate py-2 pr-3 text-sm">{piece.archetype ?? "—"}</td>
      <td className="truncate py-2 pr-3 text-sm">
        {row.tertiary !== undefined ? statLabel(row.tertiary) : "—"}
      </td>
      <td className="truncate py-2 pr-3 text-sm">
        {piece.tunedStat !== undefined ? statLabel(piece.tunedStat) : "—"}
      </td>
      <td className="truncate py-2 pr-3 text-sm">{row.setName ?? "—"}</td>
      {!BUILD_USAGE_PAUSED && (
        <td
          title={usageTitle(row.usage, row.inLoadout)}
          className={cn(
            "py-2 text-center text-sm tabular-nums",
            row.usageBucket === "unknown" && "text-muted-foreground",
          )}
        >
          {/* Used in / could have joined: the second number is what makes a 0 mean something. */}
          {row.usage?.eligible ? (
            <>
              {row.usage.used}
              <span className="text-muted-foreground">/{row.usage.eligible}</span>
            </>
          ) : (
            "—"
          )}
        </td>
      )}
      {STAT_DISPLAY_ORDER.map((key) => (
        <td key={key} className="py-2 text-center text-sm tabular-nums">
          {piece.stats[STAT_ORDER.indexOf(key)]}
        </td>
      ))}
    </tr>
  );
});
