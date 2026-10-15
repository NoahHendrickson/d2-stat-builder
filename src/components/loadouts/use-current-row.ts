"use client";

import { useCallback, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useMediaQuery } from "@/lib/use-min-width";

/** How much of a row must still show at the top of the list for it to be the current one. */
const CURRENT_ROW_MIN_VISIBLE_PX = 64;

/**
 * The row a virtualized list is showing at its top, and a smooth jump to any row.
 *
 * The last rows can't reach the top, so a row jumped to stays current while it's still
 * in view below the top. Scrolling back up, or a change to `rows` (a filter, sort, or
 * search), drops it.
 */
export function useCurrentRow(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  rows: readonly { id: string }[],
  enabled: boolean,
): { currentId: string | undefined; jumpTo: (index: number) => void } {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [jump, setJump] = useState<{
    index: number;
    rows: readonly { id: string }[];
  } | null>(null);
  // A backward scroll never lands on a row that can't reach the top, so it's the
  // player's own.
  const live =
    jump && jump.rows === rows && virtualizer.scrollDirection !== "backward" ? jump : null;
  if (jump && !live) setJump(null);

  const { scrollToIndex } = virtualizer;
  const jumpTo = useCallback(
    (index: number) => {
      setJump({ index, rows });
      scrollToIndex(index, { align: "start", behavior: reducedMotion ? "auto" : "smooth" });
    },
    [rows, scrollToIndex, reducedMotion],
  );

  if (!enabled) return { currentId: undefined, jumpTo };
  const offset = virtualizer.scrollOffset ?? 0;
  const bottom = offset + (virtualizer.scrollRect?.height ?? 0);
  const shownNow = (item: { start: number; end: number }) =>
    item.end - offset > CURRENT_ROW_MIN_VISIBLE_PX && item.start < bottom;
  const items = virtualizer.getVirtualItems();
  const jumped = live && items.find((item) => item.index === live.index);
  const current = jumped && shownNow(jumped) ? jumped : items.find(shownNow);
  return { currentId: current && rows[current.index]?.id, jumpTo };
}
