"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OptimizerInput,
  OptimizerOutput,
  OptimizerRequest,
  OptimizerResponse,
  StatArray,
} from "./types";

/**
 * Drives the optimizer Web Worker. Runs are tagged with an increasing seq so that when
 * changes fire faster than the worker finishes, only the latest run's messages are applied
 * (stale ones are dropped). Ceilings stream in ahead of the final result for live slider
 * animation; the previous result stays visible while a new run is in flight (no flicker).
 */
export function useOptimizer() {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  // Whether a solve is in flight on the current worker. A worker is single-threaded, so a
  // message posted mid-solve would queue behind it — run() checks this to terminate first.
  const inFlightRef = useRef(false);
  const [result, setResult] = useState<OptimizerOutput | null>(null);
  const [ceilings, setCeilings] = useState<StatArray | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // Identity of the latest run — lets the UI restart progress animation per search.
  const [runId, setRunId] = useState(0);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<OptimizerResponse>) => {
        const msg = e.data;
        if (msg.seq !== seqRef.current) return; // superseded run — ignore
        if (msg.kind === "progress") {
          setProgress(msg.progress);
        } else if (msg.kind === "ceilings") {
          setCeilings(msg.ceilings);
        } else {
          inFlightRef.current = false;
          setResult(msg.output);
          setCeilings(msg.output.ceilings);
          setRunning(false);
        }
      };
      worker.onerror = () => {
        inFlightRef.current = false;
        setRunning(false);
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const run = useCallback(
    (input: OptimizerInput) => {
      const seq = ++seqRef.current;
      // Kill a superseded solve so this one starts immediately instead of queueing
      // behind it (the worker is stateless — recreating it costs single-digit ms).
      if (inFlightRef.current) {
        workerRef.current?.terminate();
        workerRef.current = null;
      }
      inFlightRef.current = true;
      setRunning(true);
      setProgress(0);
      setRunId(seq);
      getWorker().postMessage({ seq, input } satisfies OptimizerRequest);
    },
    [getWorker],
  );

  // Abandon the in-flight run: bump the seq (so any late messages are ignored) and tear
  // the worker down so its CPU work stops.
  const cancel = useCallback(() => {
    seqRef.current++;
    inFlightRef.current = false;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  }, []);

  return { run, cancel, result, ceilings, running, progress, runId };
}
