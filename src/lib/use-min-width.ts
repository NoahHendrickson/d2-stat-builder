"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether `query` matches. The server (and the hydrating first client render) see
 * `false`; any later mount reads the media query synchronously, so a view mounted by
 * client-side navigation lays out for the real viewport on its first render instead of
 * flashing the narrow layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** `true` once the viewport is at least `minWidth` px wide. */
export function useMinWidth(minWidth: number): boolean {
  return useMediaQuery(`(min-width: ${minWidth}px)`);
}

/** Tailwind `md`: below it, pages lay out for phones (the `max-md:` classes). */
export const PHONE_MAX_PX = 768;

/** Laid out for a phone: narrower than Tailwind `md`. Layout only; see useTouchFirst. */
export function usePhoneWidth(): boolean {
  return !useMinWidth(PHONE_MAX_PX);
}

/**
 * The main pointer is a finger (Tailwind's `pointer-coarse`): no hover, no drag, and
 * likely no keyboard, at any width. For interaction, not layout.
 */
export function useTouchFirst(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
