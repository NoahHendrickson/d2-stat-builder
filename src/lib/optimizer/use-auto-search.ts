"use client";

import { useEffect, useRef } from "react";

/** Trailing-edge delay between an edit and the search it triggers. */
export const AUTO_SEARCH_DEBOUNCE_MS = 250;

/**
 * Auto-search policy: run `search` whenever its identity changes while `enabled`
 * (the caller memoizes it on exactly the build inputs, so a new identity means
 * "something changed"). The first run after `enabled` becomes true goes out
 * immediately — the data just became ready and nothing is being edited — and every
 * later change is debounced; the cleanup cancels a pending run. Dropping `enabled`
 * (sign-out, a refresh in flight) resets the policy so the next readiness runs at once.
 */
export function useAutoSearch(enabled: boolean, search: () => void): void {
  const hasRun = useRef(false);
  useEffect(() => {
    if (!enabled) {
      hasRun.current = false;
      return;
    }
    if (!hasRun.current) {
      hasRun.current = true;
      search();
      return;
    }
    const t = window.setTimeout(search, AUTO_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [enabled, search]);
}
