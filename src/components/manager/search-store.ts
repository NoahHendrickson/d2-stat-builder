"use client";

import { useSyncExternalStore } from "react";
import { createValueStore } from "@/lib/value-store";

/** Keys of the items the manager search matches, or null when nothing is searched. */
export const searchMatches = createValueStore<ReadonlySet<string> | null>(null);

/**
 * How a tile should look against the search: "match", "miss" (dimmed), or "none" (no
 * search on). Re-renders a tile only when its own answer changes.
 */
export function useSearchState(key: string): "match" | "miss" | "none" {
  return useSyncExternalStore(
    searchMatches.subscribe,
    () => {
      const matches = searchMatches.get();
      return matches === null ? "none" : matches.has(key) ? "match" : "miss";
    },
    () => "none",
  );
}
