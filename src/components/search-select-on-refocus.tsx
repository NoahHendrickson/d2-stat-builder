"use client";

import { useEffect } from "react";

const SEARCH_INPUT = 'input[type="search"], input[role="combobox"]';

/**
 * Clicking back into a search box that already has text selects all of it, so typing
 * replaces the old query. Clicks inside an already-focused box still place the caret.
 */
export function SearchSelectOnRefocus() {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey) return;
      const input = (e.target as Element | null)?.closest?.(SEARCH_INPUT);
      if (!(input instanceof HTMLInputElement)) return;
      if (input === document.activeElement || !input.value || input.disabled) return;
      // Stop the browser from placing the caret where the click landed, then focus and
      // select ourselves. click (and onClick handlers) still fire afterwards.
      e.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, []);

  return null;
}
