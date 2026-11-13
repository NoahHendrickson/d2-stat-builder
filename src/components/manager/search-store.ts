"use client";

import { useCallback } from "react";
import { createValueStore } from "@/lib/value-store";

/** Keys of the items the manager search matches, or null when nothing is searched. */
export const searchMatches = createValueStore<ReadonlySet<string> | null>(null);

// Every mounted tile by item key (a key can show twice, e.g. a tile and its copy in the
// search results). A search marks each one with data-search="match" | "miss" straight on
// the element, and CSS dims the misses: the first letters of a search flip hundreds of
// tiles at once, and re-rendering each of them on every keystroke made typing lag.
const tiles = new Map<string, Set<HTMLElement>>();

function mark(el: HTMLElement, key: string, matches: ReadonlySet<string> | null) {
  const state = matches === null ? undefined : matches.has(key) ? "match" : "miss";
  if (el.dataset.search === state) return;
  if (state === undefined) delete el.dataset.search;
  else el.dataset.search = state;
}

searchMatches.subscribe(() => {
  const matches = searchMatches.get();
  for (const [key, els] of tiles) for (const el of els) mark(el, key, matches);
});

/**
 * A ref for an item tile's root: keeps its data-search attribute in step with the
 * search ("match", "miss", or absent when nothing is searched), without re-rendering.
 */
export function useSearchTileRef(key: string): (el: HTMLElement | null) => (() => void) | undefined {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return undefined;
      let els = tiles.get(key);
      if (!els) tiles.set(key, (els = new Set()));
      els.add(el);
      mark(el, key, searchMatches.get());
      return () => {
        els.delete(el);
        if (els.size === 0) tiles.delete(key);
      };
    },
    [key],
  );
}
