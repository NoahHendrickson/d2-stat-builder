"use client";

import { getSetting, setSetting, useSetting } from "../settings/synced-settings";
import { orphanedSetLoadouts, type ActivitySet } from "./activity-sets";
import type { SavedLoadout } from "./types";

// Stored and synced to the account by synced-settings.ts.

export function useActivitySets(): ActivitySet[] {
  return useSetting("activitySets");
}

type LoadoutRows = readonly Pick<SavedLoadout, "id" | "setOnly">[];

/** Store the new list; answers with the private copies no set uses any more. */
function writeSets(next: ActivitySet[], loadouts: LoadoutRows): string[] {
  const before = getSetting("activitySets");
  setSetting("activitySets", next);
  return orphanedSetLoadouts(before, next, loadouts);
}

/**
 * Add a new set (at the end) or replace the one with the same id in place. Answers with
 * the private copies that left unused, for the caller to delete.
 */
export function saveActivitySet(set: ActivitySet, loadouts: LoadoutRows): string[] {
  const sets = getSetting("activitySets");
  return writeSets(
    sets.some((s) => s.id === set.id)
      ? sets.map((s) => (s.id === set.id ? set : s))
      : [...sets, set],
    loadouts,
  );
}

/** Remove a set. Answers with the private copies that left unused, for the caller to delete. */
export function removeActivitySet(id: string, loadouts: LoadoutRows): string[] {
  return writeSets(getSetting("activitySets").filter((s) => s.id !== id), loadouts);
}
