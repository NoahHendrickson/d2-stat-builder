"use client";

import { useEffect, type RefObject } from "react";

/**
 * Messages between /components/embed and the page framing it (the portfolio's D2
 * Conflux page). The embed posts its content height, so the frame grows to fit and
 * never scrolls. The parent posts which slice of the frame is on screen, so fixed
 * overlays (dialogs, drawers, toasts; globals.css `[data-embed]`) open there rather
 * than in the middle of a frame taller than the screen.
 */
export const EMBED_HEIGHT = "d2-components:height";
export const EMBED_VIEWPORT = "d2-components:viewport";

/**
 * `ready` holds the height back until the page has settled on it (the tallest-story
 * measure), so the frame doesn't jump through the open component's own height on load.
 */
export function useEmbedBridge(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  ready: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    // Opened directly rather than framed: an ordinary scrolling page.
    if (!enabled || !ready || !el || window.parent === window) return;
    const root = document.documentElement;
    root.dataset.embed = "";
    // The frame is sized to the content; a scrollbar flashing in while it catches up
    // would narrow the page and reflow it.
    root.style.overflow = "hidden";

    let last = 0;
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      // Only a height: nothing worth guarding with a target origin.
      window.parent.postMessage({ type: EMBED_HEIGHT, height }, "*");
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();

    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== EMBED_VIEWPORT) return;
      const { top, height } = e.data as { top: unknown; height: unknown };
      if (typeof top !== "number" || typeof height !== "number") return;
      root.style.setProperty("--embed-top", `${top}px`);
      root.style.setProperty("--embed-height", `${height}px`);
    };
    window.addEventListener("message", onMessage);

    return () => {
      observer.disconnect();
      window.removeEventListener("message", onMessage);
      delete root.dataset.embed;
      root.style.removeProperty("overflow");
      root.style.removeProperty("--embed-top");
      root.style.removeProperty("--embed-height");
    };
  }, [ref, enabled, ready]);
}
