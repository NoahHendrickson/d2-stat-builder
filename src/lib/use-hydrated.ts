"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` on the server and during the hydrating first client render, `true` on every
 * render after that (and immediately for anything mounted later on the client).
 *
 * For state that the server can't know but the client may already have — e.g. a
 * react-query result another part of the page fetched before this segment hydrated —
 * so the hydrating render matches the server HTML instead of throwing a mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
