"use client";

import { useEffect, useRef, useState } from "react";
import { AUTO_SEARCH_DEBOUNCE_MS } from "./use-auto-search";
import type { DreamInput, DreamResult } from "./dream";
import type { DreamRequest, DreamResponse } from "./dream-worker";

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

const IDLE: DreamBuildState = { running: false, phase: null, result: null, failed: false };

/**
 * Run the dream search for `input` whenever its identity changes (the caller memoizes it
 * on exactly the build inputs), debounced like the regular auto-search. `null` = closed:
 * nothing runs and the worker is released. A new input while one is still solving
 * terminates that worker — the solve is synchronous, so that is the only way to stop
 * it — and the stale result can't land.
 */
export function useDreamBuild(input: DreamInput | null): DreamBuildState {
  const [state, setState] = useState<{
    forInput: DreamInput | null;
    phase: number | null;
    result: DreamResult | null;
    failed: boolean;
  }>({ forInput: null, phase: null, result: null, failed: false });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  // The input the in-flight request (seq.current) was posted for.
  const inFlight = useRef<DreamInput | null>(null);
  // Set when the search is released, so reopening doesn't show the last session's list.
  const released = useRef(false);

  useEffect(() => {
    if (!input) {
      worker.current?.terminate();
      worker.current = null;
      busy.current = false;
      released.current = true;
      seq.current++;
      return;
    }
    // The first search after opening goes out at once (nothing is being edited).
    const delay = worker.current ? AUTO_SEARCH_DEBOUNCE_MS : 0;
    const t = window.setTimeout(() => {
      if (busy.current) {
        worker.current?.terminate();
        worker.current = null;
      }
      if (!worker.current) {
        const w = new Worker(new URL("./dream-worker.ts", import.meta.url), {
          type: "module",
        });
        w.onmessage = (e: MessageEvent<DreamResponse>) => {
          const msg = e.data;
          if (msg.seq !== seq.current) return;
          if (msg.kind === "phase") {
            setState((prev) => ({ ...prev, phase: msg.newPieces }));
            return;
          }
          busy.current = false;
          setState({ forInput: inFlight.current, phase: null, result: msg.result, failed: false });
        };
        // A crash in the worker would otherwise leave `running` true forever (the result
        // never lands). Settle the in-flight input as failed, keep the last result, and
        // drop the worker so the next search starts a fresh one.
        const fail = () => {
          busy.current = false;
          w.terminate();
          if (worker.current === w) worker.current = null;
          setState((prev) => ({ ...prev, forInput: inFlight.current, phase: null, failed: true }));
        };
        w.onerror = fail;
        w.onmessageerror = fail;
        worker.current = w;
      }
      const s = ++seq.current;
      busy.current = true;
      inFlight.current = input;
      if (released.current) {
        released.current = false;
        setState({ forInput: null, phase: null, result: null, failed: false });
      } else {
        setState((prev) => ({ ...prev, phase: null, failed: false }));
      }
      worker.current.postMessage({ seq: s, input } satisfies DreamRequest);
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

  if (!input) return IDLE;
  return {
    running: state.forInput !== input,
    phase: state.phase,
    result: state.result,
    failed: state.failed,
  };
}
