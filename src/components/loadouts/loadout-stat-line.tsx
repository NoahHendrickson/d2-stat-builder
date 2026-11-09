"use client";

import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import type { SavedLoadoutData } from "@/lib/loadouts/types";
import { StatGlyph } from "@/components/stat-glyph";
import { cn } from "@/lib/utils";

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));

/** A loadout's total and its stats, each with its glyph. Fragments, for a flex parent. */
export function LoadoutStatLine({
  optimizer,
  statIcons,
}: {
  optimizer: NonNullable<SavedLoadoutData["optimizer"]>;
  statIcons: StatIconMap;
}) {
  return (
    <>
      <span className="text-base font-medium">{optimizer.total}</span>
      {STAT_COLS.map(({ key, i }) => {
        const value = optimizer.stats[i];
        return (
          <span key={key} className="flex items-center gap-1 max-md:gap-0.5">
            <StatGlyph
              src={statIcons[key]}
              label={STAT_LABELS[key]}
              className="size-4 opacity-75 max-md:size-3.5"
            />
            <span className={cn(value === 0 && "text-muted-foreground")}>{value}</span>
          </span>
        );
      })}
    </>
  );
}
