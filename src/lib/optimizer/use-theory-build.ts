"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AUTO_SEARCH_DEBOUNCE_MS } from "./use-auto-search";
import type { TheoryInput, TheoryResult } from "./theory";
import type { TheoryRequest, TheoryResponse } from "./theory-worker";

export interface TheoryBuildState {
  /** True from the moment the input changes (debounce included) until its result lands. */
  running: boolean;
  /** The latest result; kept on screen (stale) while a newer search runs. */
  result: TheoryResult | null;
  /** The latest search crashed in the worker (cleared by the next one). */
  failed: boolean;
}

const IDLE: TheoryBuildState = { running: false, result: null, failed: false };

/**
 * Run the theoretical search for `input` whenever its identity changes (the caller
 * memoizes it on exactly its inputs), debounced like the regular auto-search. `null` =
 * off: nothing runs and the worker is released.
 *
 * A solve takes a few hundred ms and the worker caches the roll space between requests,
 * so an edit during a solve isn't worth terminating for: the newest input waits and goes
 * out when the worker is free (anything in between is skipped).
 */
export function useTheoryBuild(input: TheoryInput | null): TheoryBuildState {
  const [state, setState] = useState<{
    forInput: TheoryInput | null;
    result: TheoryResult | null;
    failed: boolean;
  }>({ forInput: null, result: null, failed: false });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  // The input the in-flight request was posted for (null = idle), and the next one.
  const inFlight = useRef<TheoryInput | null>(null);
  const queued = useRef<TheoryInput | null>(null);
  // Set when the search is released, so turning it back on doesn't show the last list.
  const released = useRef(false);

  useEffect(() => {
    if (!input) {
      worker.current?.terminate();
      worker.current = null;
      inFlight.current = null;
      queued.current = null;
      seq.current++;
      released.current = true;
      return;
    }
    const post = (w: Worker, next: TheoryInput) => {
      inFlight.current = next;
      w.postMessage({ seq: ++seq.current, input: next } satisfies TheoryRequest);
    };
    // The first search after turning on goes out at once (nothing is being edited).
    const delay = worker.current ? AUTO_SEARCH_DEBOUNCE_MS : 0;
    const t = window.setTimeout(() => {
      if (!worker.current) {
        const w = new Worker(new URL("./theory-worker.ts", import.meta.url), {
          type: "module",
        });
        w.onmessage = (e: MessageEvent<TheoryResponse>) => {
          if (e.data.seq !== seq.current) return;
          const done = inFlight.current;
          inFlight.current = null;
          setState({ forInput: done, result: e.data.result, failed: false });
          const next = queued.current;
          queued.current = null;
          if (next) post(w, next);
        };
        // A crash would otherwise leave `running` true forever. Settle what was in flight
        // as failed, keep the last result, and start a fresh worker next time.
        const fail = () => {
          w.terminate();
          if (worker.current === w) worker.current = null;
          const done = inFlight.current;
          inFlight.current = null;
          queued.current = null;
          setState((prev) => ({ ...prev, forInput: done, failed: true }));
        };
        w.onerror = fail;
        w.onmessageerror = fail;
        worker.current = w;
      }
      if (released.current) {
        released.current = false;
        setState({ forInput: null, result: null, failed: false });
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

  // Memoized: the builds column re-renders only when what it shows changes.
  const running = state.forInput !== input;
  const failed = state.failed && !running;
  const { result } = state;
  const view = useMemo(() => ({ running, result, failed }), [running, result, failed]);
  return input ? view : IDLE;
}
