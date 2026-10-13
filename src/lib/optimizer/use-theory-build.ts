"use client";

import type { TheoryInput, TheoryResult } from "./theory";
import type { TheoryResponse } from "./theory-worker";
import {
  useWorkerSearch,
  type WorkerSearchOptions,
  type WorkerSearchState,
} from "./use-worker-search";

/** The theoretical search reports nothing but its result (see WorkerSearchState). */
export type TheoryBuildState = Omit<WorkerSearchState<TheoryResult, null>, "extra">;

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
  return useWorkerSearch(input, {
    createWorker: () =>
      new Worker(new URL("./theory-worker.ts", import.meta.url), { type: "module" }),
    whenBusy: "queue",
    whenOff: "keep",
    read: (message) => ({ result: (message as TheoryResponse).result }),
    initialExtra: null,
    ...events,
  });
}
