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
      className="border-border/50 border-t"
    >
      <td className="overflow-hidden py-1.5 pr-3 pl-3">
        <div className="flex items-center gap-2">
          {piece.icon ? (
            <Image
              src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
              alt=""
              width={24}
              height={24}
              className="shrink-0 rounded-sm"
            />
          ) : (
            <span className="bg-muted size-6 shrink-0 rounded-sm" aria-hidden />
          )}
          <span className="truncate font-medium">{piece.name}</span>
          {piece.isArtifice && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]">
              Artifice
            </Badge>
          )}
        </div>
      </td>
      <td className="truncate py-1.5 pr-3">{CLASS_NAMES[piece.classType] ?? "—"}</td>
      <td className="truncate py-1.5 pr-3">{piece.archetype ?? "—"}</td>
      <td className="truncate py-1.5 pr-3">
        {row.tertiary !== undefined ? statLabel(row.tertiary) : "—"}
      </td>
      <td className="truncate py-1.5 pr-3">
        {piece.tunedStat !== undefined ? statLabel(piece.tunedStat) : "—"}
      </td>
      <td className="truncate py-1.5 pr-3">{row.setName ?? "—"}</td>
      {STAT_DISPLAY_ORDER.map((key) => (
        <td key={key} className="py-1.5 text-center tabular-nums">
          {piece.stats[STAT_ORDER.indexOf(key)]}
        </td>
      ))}
      <td className="py-1.5">
        <ArmorRowActions
          piece={piece}
          characters={characters}
          onDone={onRefresh}
        />
      </td>
    </tr>
  );
});
