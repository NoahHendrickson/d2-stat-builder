"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AUTO_SEARCH_DEBOUNCE_MS } from "./use-auto-search";

/** A worker search's view: the latest result (kept, stale, while a newer one runs). */
export interface WorkerSearchState<R, X> {
  /** True from the moment the input changes (debounce included) until its result lands. */
  running: boolean;
  result: R | null;
  /** The latest search crashed in the worker (cleared by the next one). */
  failed: boolean;
  /** What the running search last reported besides a result (e.g. Dream build's phase). */
  extra: X;
}

export interface WorkerSearchOptions<R, X> {
  /** Spawns the worker. It's sent `{ seq, input }` and must echo `seq` in every message. */
  createWorker: () => Worker;
  /**
   * A new input while a solve is running: "restart" terminates the worker (a synchronous
   * solve can't be stopped any other way); "queue" lets it finish, and only the newest
   * waiting input goes out next (for a worker with caches worth keeping).
   */
  whenBusy: "restart" | "queue";
  /** A null input: "release" terminates the worker; "keep" leaves it idle, caches and all. */
  whenOff: "release" | "keep";
  /** A message of the current search → its result, or an `extra` update. */
  read: (message: unknown) => { result: R } | { extra: X };
  /** `extra` before a search reports any. */
  initialExtra: X;
  /** A search goes out to the worker. */
  onStart?: () => void;
  /** A search's result lands. */
  onResult?: (result: R) => void;
}

/**
 * Run a worker search for `input` whenever its identity changes (the caller memoizes it
 * on exactly its inputs), debounced like the regular auto-search; the first search after
 * turning on goes out at once (nothing is being edited). `null` = off: nothing runs, and
 * turning back on doesn't show the last session's result.
 */
export function useWorkerSearch<I, R, X>(
  input: I | null,
  options: WorkerSearchOptions<R, X>,
): WorkerSearchState<R, X> {
  // Handlers fire from worker events, after render: read the latest options there.
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const [state, setState] = useState<{
    forInput: I | null;
    result: R | null;
    failed: boolean;
    extra: X;
  }>({ forInput: null, result: null, failed: false, extra: options.initialExtra });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  // The input the in-flight request was posted for (null = idle), and the next one.
  const inFlight = useRef<I | null>(null);
  const queued = useRef<I | null>(null);
  // Set when the search is turned off, so turning it back on starts clean.
  const released = useRef(true);

  useEffect(() => {
    if (!input) {
      if (opts.current.whenOff === "release") {
        worker.current?.terminate();
        worker.current = null;
      }
      inFlight.current = null;
      queued.current = null;
      seq.current++;
      released.current = true;
      return;
    }
    const post = (w: Worker, next: I) => {
      inFlight.current = next;
      opts.current.onStart?.();
      w.postMessage({ seq: ++seq.current, input: next });
    };
    const delay = released.current ? 0 : AUTO_SEARCH_DEBOUNCE_MS;
    const t = window.setTimeout(() => {
      const { whenBusy, initialExtra } = opts.current;
      if (whenBusy === "restart" && inFlight.current) {
        worker.current?.terminate();
        worker.current = null;
        inFlight.current = null;
      }
      if (!worker.current) {
        const w = opts.current.createWorker();
        w.onmessage = (e: MessageEvent<{ seq: number }>) => {
          if (e.data.seq !== seq.current) return;
          const read = opts.current.read(e.data);
          if ("extra" in read) {
            setState((prev) => ({ ...prev, extra: read.extra }));
            return;
          }
          const done = inFlight.current;
          inFlight.current = null;
          opts.current.onResult?.(read.result);
          setState({ forInput: done, result: read.result, failed: false, extra: opts.current.initialExtra });
          const next = queued.current;
          queued.current = null;
          if (next) post(w, next);
        };
        // A crash would otherwise leave `running` true forever. Settle the newest input
        // (queued or in flight) as failed, keep the last result, and start a fresh worker
        // next time.
        const fail = () => {
          w.terminate();
          if (worker.current === w) worker.current = null;
          const settled = queued.current ?? inFlight.current;
          inFlight.current = null;
          queued.current = null;
          setState((prev) => ({ ...prev, forInput: settled, failed: true, extra: opts.current.initialExtra }));
        };
        w.onerror = fail;
        w.onmessageerror = fail;
        worker.current = w;
      }
      if (released.current) {
        released.current = false;
        setState({ forInput: null, result: null, failed: false, extra: initialExtra });
      } else {
        setState((prev) => ({ ...prev, failed: false, extra: initialExtra }));
      }
      if (inFlight.current) queued.current = input;
      else post(worker.current, input);
    }, delay);
    return () => window.clearTimeout(t);
  }, [input]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  // Memoized: consumers re-render only when what they show changes.
  const running = Boolean(input) && state.forInput !== input;
  const failed = Boolean(input) && state.failed && !running;
  const result = input ? state.result : null;
  const extra = input ? state.extra : options.initialExtra;
  return useMemo(() => ({ running, result, failed, extra }), [running, result, failed, extra]);
}
