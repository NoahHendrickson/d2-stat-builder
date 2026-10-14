"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type FocusEvent } from "react";

/**
 * An `onBlur` for a box whose popup sits in the page flow, so closing it moves what's below.
 * Focus leaves before the click lands: on the press with a mouse, and between a tap's
 * synthetic mousedown and click on touch. Closing right away would slide something else under
 * the pointer, so this closes on the tick after the press ends (after its click), and only if
 * focus is still outside the box.
 */
export function useCloseAfterClick(close: () => void) {
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  const box = useRef<HTMLElement | null>(null);
  // "held": a primary press is down; "closeOnRelease": focus left the box during it.
  const press = useRef<"idle" | "held" | "closeOnRelease">("idle");
  const timer = useRef<number | undefined>(undefined);

  const closeSoon = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!box.current?.contains(document.activeElement)) latest.current();
    });
  }, []);

  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (event.isPrimary && event.button === 0) press.current = "held";
    };
    const up = () => {
      if (press.current === "closeOnRelease") closeSoon();
      press.current = "idle";
    };
    // On the window in the capture phase, so no handler can stop them first. A release the
    // page never sees (over another window, under a context menu) ends with the window's blur.
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", up);
      window.clearTimeout(timer.current);
    };
  }, [closeSoon]);

  return (event: FocusEvent<HTMLElement>) => {
    box.current = event.currentTarget;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    if (press.current === "held") press.current = "closeOnRelease";
    else closeSoon();
  };
}
