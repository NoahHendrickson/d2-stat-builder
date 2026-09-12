"use client";

import { useSyncExternalStore } from "react";

/**
 * `true` once the viewport is at least `minWidth` px wide. The server (and the
 * hydrating first client render) see `false`; any later mount reads the media query
 * synchronously, so a view mounted by client-side navigation lays out for the real
 * viewport on its first render instead of flashing the narrow layout.
 */
export function useMinWidth(minWidth: number): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(`(min-width: ${minWidth}px)`).matches,
    () => false,
  );
}
