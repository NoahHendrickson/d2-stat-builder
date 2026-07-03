"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Smooths raw progress into a fluid displayed value. A rAF loop eases the
 * displayed fraction toward the reported progress while the run is live (with a slight
 * forward trickle so the bar never sits dead, capped just ahead of the real value), and
 * sweeps it to 100% once the run finishes. `showLoading` stays true through that final
 * sweep, so even instant runs render a brief fluid fill instead of a flash.
 */
export function useSmoothedProgress(
  progress: number,
  running: boolean,
  runId: number,
) {
  const [displayed, setDisplayed] = useState(0);
  const [showLoading, setShowLoading] = useState(false);
  const displayedRef = useRef(0);
  const targetRef = useRef({ progress, running });
  targetRef.current = { progress, running };

  // Each new run (including one superseding an in-flight run) restarts the sweep.
  useEffect(() => {
    if (runId === 0) return;
    displayedRef.current = 0;
    setDisplayed(0);
    setShowLoading(true);
  }, [runId]);

  useEffect(() => {
    if (!showLoading) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can predate the performance.now() that seeded `last` — clamp so
      // a bogus negative dt can't run the easing math backwards.
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      const { progress: p, running: r } = targetRef.current;
      const prev = displayedRef.current;
      let next: number;
      if (r) {
        // Track the live progress near-real-time; when it's quiet, trickle forward
        // slowly but never more than a touch ahead of the real value.
        const eased = prev + Math.max(0, p - prev) * (1 - Math.exp(-14 * dt));
        const trickle = Math.min(prev + dt * 0.04, p + 0.06);
        next = Math.min(0.98, Math.max(prev, eased, trickle));
      } else {
        // Run finished — sweep quickly to full, then hand back to the results.
        next = prev + (1 - prev) * (1 - Math.exp(-25 * dt));
        if (next >= 0.995) {
          displayedRef.current = 0;
          setShowLoading(false);
          return;
        }
      }
      displayedRef.current = next;
      setDisplayed(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showLoading]);

  return { displayedProgress: displayed, showLoading };
}
