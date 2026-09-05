"use client";

import { useSyncExternalStore } from "react";
import { getOptimizerStore } from "./optimizer-store";

/**
 * Subscribe to the app-wide optimizer store (see optimizer-store.ts). The worker and
 * every piece of search state live outside React, so unmounting the builder (switching
 * tabs) doesn't cancel a search, and mounting it again re-attaches to whatever is in
 * flight or finished. Raw progress is exposed as a value store, not React state — only
 * the progress bar subscribes to it.
 */
export function useOptimizer() {
  const store = getOptimizerStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    run: store.run,
    cancel: store.cancel,
    applyPending: store.applyPending,
    progress: store.progress,
    ...snapshot,
  };
}
