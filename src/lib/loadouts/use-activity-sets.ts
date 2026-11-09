"use client";

import { getSetting, setSetting, useSetting } from "../settings/synced-settings";
import { orphanedSetLoadouts, type ActivitySet } from "./activity-sets";
import type { SavedLoadout } from "./types";

// Stored and synced to the account by synced-settings.ts.

export function useActivitySets(): ActivitySet[] {
  return useSetting("activitySets");
}

/** Add a new set (at the end) or replace the one with the same id in place. */
export function saveActivitySet(set: ActivitySet): void {
  const sets = getSetting("activitySets");
  setSetting(
    "activitySets",
    sets.some((s) => s.id === set.id)
      ? sets.map((s) => (s.id === set.id ? set : s))
      : [...sets, set],
  );
}

/**
 * Make a change to the sets, then report the set-only loadouts it left unused so the
 * caller can delete them.
 */
export function changeActivitySets(
  change: () => void,
  loadouts: readonly SavedLoadout[],
  onOrphan: (loadoutId: string) => void,
): void {
  const before = getSetting("activitySets");
  change();
  orphanedSetLoadouts(before, getSetting("activitySets"), loadouts).forEach(onOrphan);
}

export function removeActivitySet(id: string): void {
  setSetting(
    "activitySets",
    getSetting("activitySets").filter((s) => s.id !== id),
  );
}
