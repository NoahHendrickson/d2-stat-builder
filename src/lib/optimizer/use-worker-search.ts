"use client";

import { useEffect, useMemo, useState } from "react";
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
  /**
   * A null input: "release" terminates the worker; "keep" leaves an idle worker alive,
   * caches and all (a busy one is terminated: what it's solving is no longer wanted).
   */
  whenOff: "release" | "keep";
  /** A worker message → its search's result, or an `extra` update. */
  read: (message: unknown) => { result: R } | { extra: X };
  /** `extra` before a search reports any. */
  initialExtra: X;
  /** A search goes out to the worker. */
  onStart?: () => void;
  /** The current search's result lands. */
  onResult?: (result: R) => void;
}

/** What the search shows, with the input it's settled for (≠ the current input = running). */
export interface SearchSnapshot<I, R, X> {
  forInput: I | null;
  result: R | null;
  failed: boolean;
  extra: X;
}

/**
 * The worker side of a search, outside React so it can be tested with a fake worker.
 * `seq` numbers every request; the worker echoes it, so a reply to a superseded request
 * is ignored. `busySeq` is the request the worker is solving right now, whether or not
 * it's still wanted, so a new request never queues blindly behind a stale solve.
 */
export function createWorkerSearch<I, R, X>(
  initial: WorkerSearchOptions<R, X>,
  update: (next: (prev: SearchSnapshot<I, R, X>) => SearchSnapshot<I, R, X>) => void,
) {
  let opts = initial;
  let worker: Worker | null = null;
  let seq = 0;
  let busySeq: number | null = null;
  let inFlight: I | null = null;
  let queued: I | null = null;
  // Off since the last search: the next one starts clean and goes out at once.
  let released = true;

  const terminate = () => {
    worker?.terminate();
    worker = null;
    busySeq = null;
  };

  const spawn = (): Worker => {
    const w = opts.createWorker();
    w.onmessage = (e: MessageEvent<{ seq: number }>) => {
      const read = opts.read(e.data);
      const current = e.data.seq === seq;
      if ("result" in read && e.data.seq === busySeq) busySeq = null;
      if (current && "extra" in read) {
        const extra = read.extra;
        update((prev) => ({ ...prev, extra }));
      } else if (current && "result" in read) {
        const done = inFlight;
        inFlight = null;
        opts.onResult?.(read.result);
        update(() => ({ forInput: done, result: read.result, failed: false, extra: opts.initialExtra }));
      }
      if (busySeq === null && queued) {
        const next = queued;
        queued = null;
        post(next);
      }
    };
    // A crash would otherwise leave `running` true forever. A newer input that was
    // waiting goes out on a fresh worker; otherwise, if the crash was the current
    // search's, it settles as failed (the last result stays up).
    const fail = () => {
      if (worker !== w) return;
      const crashedCurrent = busySeq === seq;
      terminate();
      const next = queued;
      queued = null;
      if (next) {
        post(next);
      } else if (crashedCurrent) {
        const done = inFlight;
        inFlight = null;
        update((prev) => ({ ...prev, forInput: done, failed: true, extra: opts.initialExtra }));
      }
    };
    w.onerror = fail;
    w.onmessageerror = fail;
    return w;
  };

  const post = (next: I) => {
    worker ??= spawn();
    inFlight = next;
    busySeq = ++seq;
    opts.onStart?.();
    worker.postMessage({ seq, input: next });
  };

  return {
    setOptions(next: WorkerSearchOptions<R, X>) {
      opts = next;
    },
    /** Off since the last search (its first one goes out without the debounce). */
    get released() {
      return released;
    },
    /** Search for `input`, or queue it behind the solve that's running. */
    run(input: I) {
      if (opts.whenBusy === "restart" && busySeq !== null) terminate();
      const extra = opts.initialExtra;
      if (released) {
        released = false;
        update(() => ({ forInput: null, result: null, failed: false, extra }));
      } else {
        update((prev) => ({ ...prev, failed: false, extra }));
      }
      if (busySeq !== null) queued = input;
      else post(input);
    },
    /** Turned off: drop what's waiting; keep the worker only if it's idle and wanted. */
    off() {
      if (opts.whenOff === "release" || busySeq !== null) terminate();
      inFlight = null;
      queued = null;
      seq++;
      released = true;
    },
    dispose: terminate,
  };
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
  const [state, setState] = useState<SearchSnapshot<I, R, X>>({
    forInput: null,
    result: null,
    failed: false,
    extra: options.initialExtra,
  });
  const [search] = useState(() => createWorkerSearch<I, R, X>(options, setState));
  // Handlers fire from worker events, after render: hand them the latest options.
  useEffect(() => search.setOptions(options));

  useEffect(() => {
    if (!input) {
      search.off();
      return;
    }
    const t = window.setTimeout(
      () => search.run(input),
      search.released ? 0 : AUTO_SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [input, search]);

  useEffect(() => () => search.dispose(), [search]);

  // Memoized: consumers re-render only when what they show changes.
  const running = Boolean(input) && state.forInput !== input;
  const failed = Boolean(input) && state.failed && !running;
  const result = input ? state.result : null;
  const extra = input ? state.extra : options.initialExtra;
  return useMemo(() => ({ running, result, failed, extra }), [running, result, failed, extra]);
}
