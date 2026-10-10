"use client";

// The account's pinned armor sets (synced setting `pinnedSets`), shared by every set
// menu, the optimizer's roll grid, and the armor table filters.
import { togglePinned } from "../armor-table/pinned";
import { getSetting, setSetting, useSetting } from "./synced-settings";

/** Pin or unpin a set everywhere (new pins go last). */
export function togglePinnedSet(setHash: number) {
  setSetting("pinnedSets", togglePinned(getSetting("pinnedSets"), setHash));
}

/** Add pins kept elsewhere (an older per-page copy) after the current ones, once. */
export function adoptPinnedSets(setHashes: readonly number[]) {
  const current = getSetting("pinnedSets");
  const added = setHashes.filter((h) => !current.includes(h));
  if (added.length > 0) setSetting("pinnedSets", [...current, ...added]);
}

/** The account's pinned sets, in pin order. */
export function usePinnedSets(): number[] {
  return useSetting("pinnedSets");
}
