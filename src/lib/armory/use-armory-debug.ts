"use client";

import { useSyncExternalStore } from "react";

function getDebugEnabled(): boolean {
  return new URLSearchParams(window.location.search).has("debug");
}

function subscribeDebug(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

/** True when the URL includes `?debug` (any value) — opt-in armory diagnostics. */
export function useArmoryDebug(): boolean {
  return useSyncExternalStore(subscribeDebug, getDebugEnabled, () => false);
}
