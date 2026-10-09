"use client";

import { useEffect, useState } from "react";

/**
 * `true` from the render where `key` changes (and on mount) until `ms` later — the
 * window a `d2-stagger` list needs to play its cascade. Drop the class after that:
 * the browser restarts a CSS animation when React moves its node, so a re-sort of a
 * list that kept the class would replay the rise on whichever rows moved.
 */
export function useEntrance(key: unknown, ms = 600): boolean {
  const [state, setState] = useState({ key, live: true });
  // A new key re-arms the window during render, so its first paint already animates.
  if (state.key !== key) setState({ key, live: true });
  useEffect(() => {
    if (!state.live) return;
    const timer = setTimeout(
      () => setState((s) => (s.key === key ? { key, live: false } : s)),
      ms,
    );
    return () => clearTimeout(timer);
  }, [state, key, ms]);
  return state.key !== key || state.live;
}
