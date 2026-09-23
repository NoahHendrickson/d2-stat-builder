"use client";

import { useSyncExternalStore, useEffect } from "react";
import { getOptimizerStore } from "./optimizer-store";

/**
 * Subscribe to the app-wide optimizer store (see optimizer-store.ts). The worker and
 * every piece of search state live outside React, so unmounting the builder (switching
 * tabs) doesn't cancel a search, and mounting it again re-attaches to whatever is in
 * flight or finished. Raw progress is exposed as a value store, not React state — only
 * the progress bar subscribes to it.
 *
 * `result` is a convenience view of `shown.result`; the paired `shown.origin` is what a
 * shown build's actions read (via `getSnapshot`, at click time).
 */
export function useOptimizer() {
  const store = getOptimizerStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Spawn the worker as soon as anything subscribes, so the first search doesn't also
  // wait on the worker chunk fetch and module evaluation.
  useEffect(() => store.warm(), [store]);
  return {
    run: store.run,
    cancel: store.cancel,
    applyPending: store.applyPending,
    /** Non-subscribing read of the current snapshot, for click-time reads of `shown`. */
    getSnapshot: store.getSnapshot,
    progress: store.progress,
    refinementProgress: store.refinementProgress,
    ceilingsView: store.ceilingsView,
    ...snapshot,
    result: snapshot.shown?.result ?? null,
  };
}
