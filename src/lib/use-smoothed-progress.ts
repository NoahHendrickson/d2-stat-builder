"use client";

import { useEffect, useRef, useState } from "react";
import { createValueStore, type ValueStore } from "./value-store";

/**
 * Smooths raw progress into a fluid displayed value. A rAF loop eases the displayed
 * fraction toward the reported progress while the run is live (with a slight forward
 * trickle so the bar never sits dead, capped just ahead of the real value), and sweeps
 * it to 100% once the run finishes. `showLoading` stays true through that final sweep,
 * so even instant runs render a brief fluid fill instead of a flash.
 *
 * The per-frame value is written to a value store, NOT React state: only the progress
 * bar subscribes (`useStoreValue`), so the 60 Hz loop never re-renders the component
 * that owns the search. `showLoading` is React state because it flips twice per run.
 */
export function useSmoothedProgress(
  progress: ValueStore<number>,
  running: boolean,
  runId: number,
): { displayedProgress: ValueStore<number>; showLoading: boolean } {
  const [displayed] = useState(() => createValueStore(0));
  // On mount, only show the sweep if a run is actually live (a re-mounted builder with
  // a finished result must not flash the loading state).
  const [showLoading, setShowLoading] = useState(() => running);
  // The rAF loop reads `running` per frame; keep it in a ref, updated after commit
  // (a frame of lag at most, and no ref writes during render).
  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  const seenRunId = useRef(runId);

  // Each new run (including one superseding an in-flight run) restarts the sweep.
  useEffect(() => {
    if (runId === seenRunId.current) return;
    seenRunId.current = runId;
    displayed.set(0);
    setShowLoading(true);
  }, [runId, displayed]);

  useEffect(() => {
    if (!showLoading) return;
    let raf = 0;
    let last = performance.now();
    const tick = (nowTs: number) => {
      // rAF timestamps can predate the performance.now() that seeded `last` — clamp so
      // a bogus negative dt can't run the easing math backwards.
      const dt = Math.max(0, Math.min(0.1, (nowTs - last) / 1000));
      last = nowTs;
      const p = progress.get();
      const prev = displayed.get();
      let next: number;
      if (runningRef.current) {
        // Track the live progress near-real-time; when it's quiet, trickle forward
        // slowly but never more than a touch ahead of the real value.
        const eased = prev + Math.max(0, p - prev) * (1 - Math.exp(-14 * dt));
        const trickle = Math.min(prev + dt * 0.04, p + 0.06);
        next = Math.min(0.98, Math.max(prev, eased, trickle));
      } else {
        // Run finished — sweep quickly to full, then hand back to the results.
        next = prev + (1 - prev) * (1 - Math.exp(-25 * dt));
        if (next >= 0.995) {
          displayed.set(0);
          setShowLoading(false);
          return;
        }
      }
      displayed.set(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showLoading, progress, displayed]);

  return { displayedProgress: displayed, showLoading };
}
