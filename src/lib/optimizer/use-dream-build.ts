"use client";

import { useMemo } from "react";
import type { DreamInput, DreamResult } from "./dream";
import type { DreamResponse } from "./dream-worker";
import { useWorkerSearch, type WorkerSearchOptions } from "./use-worker-search";

export interface DreamBuildState {
  /**
   * True from the moment the input changes (debounce included) until its result lands,
   * so the UI shows work the instant a target moves.
   */
  running: boolean;
  /** How many new pieces the running search is checking (null before it reports). */
  phase: number | null;
  /** The latest result; kept on screen (stale) while a newer search runs. */
  result: DreamResult | null;
  /** The latest search crashed in the worker (cleared by the next one). */
  failed: boolean;
}

// The dream solve is one synchronous search, so a new input while it runs terminates the
// worker (the only way to stop it), and closing the modal releases it.
const OPTIONS: WorkerSearchOptions<DreamResult, number | null> = {
  createWorker: () =>
    new Worker(new URL("./dream-worker.ts", import.meta.url), { type: "module" }),
  whenBusy: "restart",
  whenOff: "release",
  read: (message) => {
    const msg = message as DreamResponse;
    return msg.kind === "phase" ? { extra: msg.newPieces } : { result: msg.result };
  },
  initialExtra: null,
};

/**
 * Run the dream search for `input` whenever its identity changes (see useWorkerSearch).
 * `null` = closed: nothing runs and the worker is released.
 */
export function useDreamBuild(input: DreamInput | null): DreamBuildState {
  const { running, result, failed, extra } = useWorkerSearch(input, OPTIONS);
  return useMemo(() => ({ running, phase: extra, result, failed }), [running, extra, result, failed]);
}
