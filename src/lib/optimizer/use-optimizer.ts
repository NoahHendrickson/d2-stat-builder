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
 * How a background ceilings refinement ended: it proved higher per-stat maxima than
 * the capped search reported (the slider overlays rose — raise a target to explore),
 * or it found none. Null while no refinement has resolved. The build list itself is
 * frozen at what the capped search found, by design — refinement only ever moves the
 * overlays.
 */
export type RefineOutcome = "improved" | "confirmed" | null;

/**
 * Drives the optimizer Web Worker. Runs are tagged with an increasing seq so that when
 * changes fire faster than the worker finishes, only the latest run's messages are applied
 * (stale ones are dropped). Ceilings stream in ahead of the final result for live slider
 * animation; the previous result stays visible while a new run is in flight (no flicker).
 *
 * A time-capped search posts its result (`refining` becomes true) with a build list
 * that is FINAL for this query — the list never changes under the reader — while the
 * worker keeps refining the per-stat ceilings in the background. `refineProgress`
 * streams that pass; rising ceilings surface live in the slider overlays; and when it
 * lands `refineOutcome` says whether higher maxima were found. The worker stays "in
 * flight" through refinement so a new run (or cancel) terminates the background CPU
 * work immediately.
 */
export function useOptimizer() {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  // Whether a solve is in flight on the current worker. A worker is single-threaded, so a
  // message posted mid-solve would queue behind it — run() checks this to terminate first.
  const inFlightRef = useRef(false);
  // Between the interim (refining) result and the final one; refs mirror state for the
  // stable onmessage closure.
  const refiningRef = useRef(false);
  const interimRef = useRef<OptimizerOutput | null>(null);
  const [result, setResult] = useState<OptimizerOutput | null>(null);
  const [ceilings, setCeilings] = useState<StatArray | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [refining, setRefining] = useState(false);
  const [refineProgress, setRefineProgress] = useState(0);
  const [refineOutcome, setRefineOutcome] = useState<RefineOutcome>(null);
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
          if (refiningRef.current) setRefineProgress(msg.progress);
          else setProgress(msg.progress);
        } else if (msg.kind === "ceilings") {
          if (refiningRef.current) {
            // The background pass seeds from the interim's ceilings so it can't truly
            // regress, but merge monotonically anyway — the UI must never show a
            // ceiling dropping while the same query refines.
            setCeilings((prev) =>
              prev ? msg.ceilings.map((v, s) => Math.max(v, prev[s])) : msg.ceilings,
            );
          } else {
            setCeilings(msg.ceilings);
          }
        } else if (msg.refining) {
          // Time-capped search: its build list is final and shown now (and never
          // replaced); the worker is still refining ceilings, so stay "in flight"
          // for cancellation.
          refiningRef.current = true;
          interimRef.current = msg.output;
          setResult(msg.output);
          setCeilings(msg.output.ceilings);
          setRunning(false);
          setRefining(true);
          setRefineProgress(0);
        } else {
          const interim = interimRef.current;
          refiningRef.current = false;
          interimRef.current = null;
          inFlightRef.current = false;
          // After a refinement this carries the SAME loadouts (list stays frozen) with
          // the refined ceilings — setting it only updates ceilings/refine state.
          setResult(msg.output);
          setCeilings((prev) =>
            interim && prev
              ? msg.output.ceilings.map((v, s) => Math.max(v, prev[s]))
              : msg.output.ceilings,
          );
          setRunning(false);
          setRefining(false);
          if (interim) {
            const rose = msg.output.ceilings.some(
              (v, s) => v > interim.ceilings[s],
            );
            setRefineOutcome(rose ? "improved" : "confirmed");
          }
        }
      };
      worker.onerror = () => {
        inFlightRef.current = false;
        refiningRef.current = false;
        interimRef.current = null;
        setRunning(false);
        setRefining(false);
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
      // inFlight covers background refinement too: its CPU work dies here.
      if (inFlightRef.current) {
        workerRef.current?.terminate();
        workerRef.current = null;
      }
      inFlightRef.current = true;
      refiningRef.current = false;
      interimRef.current = null;
      setRunning(true);
      setProgress(0);
      setRefining(false);
      setRefineProgress(0);
      setRefineOutcome(null);
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
    refiningRef.current = false;
    interimRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setRefining(false);
    setRefineOutcome(null);
  }, []);

  return {
    run,
    cancel,
    result,
    ceilings,
    running,
    progress,
    runId,
    refining,
    refineProgress,
    refineOutcome,
  };
}
