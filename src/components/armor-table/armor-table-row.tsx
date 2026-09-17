"use client";

import Image from "next/image";
import { memo } from "react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_ORDER,
} from "@/lib/armory/stats";
import { statLabel } from "@/lib/armor-table/sort";
import { Badge } from "@/components/ui/badge";
import { ArmorRowActions } from "@/components/armor-table/armor-row-actions";
import { ArmorThumb } from "@/components/armor-thumb";

export const COLUMN_COUNT = 13;

/** Column widths: name is capped; Class→Set share leftover so wide screens
 *  don't leave a huge empty gap after the piece name. Stats/actions stay fixed. */
export const TABLE_COLGROUP = (
  <colgroup>
    <col style={{ width: "18rem" }} /* name */ />
    <col /* class — flexible */ />
    <col /* archetype — flexible */ />
    <col /* tertiary — flexible */ />
    <col /* tuned — flexible */ />
    <col /* set — flexible */ />
    {STAT_DISPLAY_ORDER.map((key) => (
      <col key={key} style={{ width: "3.25rem" }} />
    ))}
    <col style={{ width: "8rem" }} /* actions */ />
  </colgroup>
);

export interface Row {
  piece: ArmorPiece;
  setName?: string;
  /** Tertiary archetype stat index — Armor 3.0 pieces only. */
  tertiary?: number;
  /** `normalizeSearchText(piece.name)` — computed once with the row. */
  searchName: string;
}

export const ArmorRow = memo(function ArmorRow({
  row,
  characters,
  onRefresh,
  dataIndex,
  measureRef,
}: {
  row: Row;
  characters: ArmoryCharacter[];
  onRefresh: () => void;
  dataIndex: number;
  measureRef: (el: HTMLTableRowElement | null) => void;
}) {
  const { piece } = row;
  return (
    <tr
      ref={measureRef}
      data-index={dataIndex}
      className="border-t border-border hover:bg-foreground/4 d2:border-foreground/8 d2:hover:bg-foreground/6"
    >
      <td className="overflow-hidden py-2 pr-3 pl-3">
        <div className="flex items-center gap-2">
          {piece.icon ? (
            piece.isExotic ? (
              <ArmorThumb
                icon={piece.icon}
                watermark={piece.watermark}
                size={32}
                exoticFrame
                isTier5={piece.tunedStat !== undefined}
              />
            ) : (
              <Image
                src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
                alt=""
                width={32}
                height={32}
                className="d2-tile size-8 shrink-0 rounded-[2px] d2:rounded-none"
                unoptimized
              />
            )
          ) : (
            <span className="d2-brackets size-8 shrink-0 rounded-[2px] bg-muted d2:rounded-none d2:bg-black/25" aria-hidden />
          )}
          <span className="truncate text-sm">{piece.name}</span>
          {piece.isArtifice && (
            <Badge variant="outline" className="px-1.5 text-[10px]">
              Artifice
            </Badge>
          )}
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
      {STAT_DISPLAY_ORDER.map((key) => (
        <td key={key} className="py-2 text-center text-sm tabular-nums">
          {piece.stats[STAT_ORDER.indexOf(key)]}
        </td>
      ))}
      <td className="py-2">
        <ArmorRowActions
          piece={piece}
          characters={characters}
          onDone={onRefresh}
        />
      </td>
    </tr>
  );
});
