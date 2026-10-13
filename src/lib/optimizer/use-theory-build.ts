"use client";

import { useMemo } from "react";
import type { TheoryInput, TheoryResult } from "./theory";
import type { TheoryResponse } from "./theory-worker";
import { useWorkerSearch, type WorkerSearchOptions } from "./use-worker-search";

export interface TheoryBuildState {
  /** True from the moment the input changes (debounce included) until its result lands. */
  running: boolean;
  /** The latest result; kept on screen (stale) while a newer search runs. */
  result: TheoryResult | null;
  /** The latest search crashed in the worker (cleared by the next one). */
  failed: boolean;
}

/**
 * Run the theoretical search for `input` whenever its identity changes (see
 * useWorkerSearch). A solve takes a few hundred ms and the worker caches the roll space,
 * so an edit mid-solve waits rather than restarting it, and switching tabs (`null`) leaves
 * the worker idle instead of releasing it. `onStart` / `onResult` fire from the worker's
 * events (the slider maxima follow them).
 */
export function useTheoryBuild(
  input: TheoryInput | null,
  events: Pick<WorkerSearchOptions<TheoryResult, null>, "onStart" | "onResult"> = {},
): TheoryBuildState {
  const { running, result, failed } = useWorkerSearch(input, {
    createWorker: () =>
      new Worker(new URL("./theory-worker.ts", import.meta.url), { type: "module" }),
    whenBusy: "queue",
    whenOff: "keep",
    read: (message) => ({ result: (message as TheoryResponse).result }),
    initialExtra: null,
    ...events,
  });
  return useMemo(() => ({ running, result, failed }), [running, result, failed]);
}
