"use client";

import { useEffect, useState } from "react";

/**
 * `true` once the viewport is at least `minWidth` px wide. Starts `false` on the
 * server and the first client render (no hydration mismatch), then tracks the media
 * query.
 */
export function useMinWidth(minWidth: number): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [minWidth]);

  return matches;
}
