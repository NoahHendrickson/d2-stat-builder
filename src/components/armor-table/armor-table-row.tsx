"use client";

import Image from "next/image";
import { memo } from "react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  CLASS_NAMES,
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_ORDER,
} from "@/lib/armory/stats";
import { LOCATION_LABELS, statLabel } from "@/lib/armor-table/sort";
import { Badge } from "@/components/ui/badge";
import { ArmorRowActions } from "@/components/armor-table/armor-row-actions";

export const COLUMN_COUNT = 15;

/** Fixed column widths keep the layout steady while rows virtualize in and out. */
export const TABLE_COLGROUP = (
  <colgroup>
    <col /* name */ />
    <col style={{ width: "4.5rem" }} /* class */ />
    <col style={{ width: "5rem" }} /* slot */ />
    <col style={{ width: "6.5rem" }} /* archetype */ />
    <col style={{ width: "5rem" }} /* tertiary */ />
    <col style={{ width: "5rem" }} /* tuned */ />
    <col style={{ width: "9.5rem" }} /* set */ />
    {STAT_ORDER.map((key) => (
      <col key={key} style={{ width: "3rem" }} />
    ))}
    <col style={{ width: "5.5rem" }} /* location */ />
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
          {piece.isExotic && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              Exotic
            </Badge>
          )}
          {piece.isArtifice && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]">
              Artifice
            </Badge>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {CLASS_NAMES[piece.classType] ?? "—"}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">{SLOT_LABELS[piece.slot]}</td>
      <td className="truncate py-1.5 pr-3">{piece.archetype ?? "—"}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {row.tertiary !== undefined ? statLabel(row.tertiary) : "—"}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {piece.tunedStat !== undefined ? statLabel(piece.tunedStat) : "—"}
      </td>
      <td className="truncate py-1.5 pr-3">{row.setName ?? "—"}</td>
      {STAT_DISPLAY_ORDER.map((key) => (
        <td key={key} className="py-1.5 pr-3 text-right tabular-nums">
          {piece.stats[STAT_ORDER.indexOf(key)]}
        </td>
      ))}
      <td className="text-muted-foreground py-1.5 pr-3 whitespace-nowrap">
        {LOCATION_LABELS[piece.location]}
      </td>
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
