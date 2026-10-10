"use client";

import { useEffect, useRef, useState } from "react";
import { activePicks, findPerkFinderResult, type PerkFinderArgs, type PerkFinderResult } from "./perk-finder";
import type { PerkFinderRequest, PerkFinderResponse } from "./perk-finder-worker";

/** How long a search runs before the finder says it's still working. */
const SLOW_MS = 200;

export interface PerkFinderState {
  /**
   * The latest result. While `pending` it's for earlier picks, kept on screen so the
   * table doesn't blank between clicks. Null before the first one lands.
   */
  result: PerkFinderResult | null;
  /** `result` isn't for the current picks yet, so nothing may act on it (e.g. junk tagging). */
  pending: boolean;
  /** Still pending after a moment: worth telling the user. */
  slow: boolean;
}

const solve = (args: PerkFinderArgs) =>
  findPerkFinderResult(args.items, args.priority, args.mode, args.customOrder, args.combos);

/** No picks means nothing to search: answer on the spot. */
const nothingPicked = (args: PerkFinderArgs) => activePicks(args.priority, args.mode, args.combos).length === 0;

/**
 * The perk finder's result for `args` (memoized by the caller on exactly the solver's
 * inputs; `null` while the finder is closed, which releases the worker). The search
 * runs in a worker: with many copies and ranked picks in every column it can take
 * seconds, and the page must stay usable meanwhile. A newer request terminates a busy
 * worker, and responses for anything but the latest request are dropped, so a stale
 * result can never land as the current one. Without workers (or after one crashes)
 * it solves on the main thread, as before.
 */
export function usePerkFinder(args: PerkFinderArgs | null): PerkFinderState {
  const [broken, setBroken] = useState(false);
  const answerHere = (a: PerkFinderArgs) => nothingPicked(a) || broken || typeof Worker === "undefined";

  const [landed, setLanded] = useState<{ forArgs: PerkFinderArgs; result: PerkFinderResult } | null>(() =>
    args && answerHere(args) ? { forArgs: args, result: solve(args) } : null,
  );
  // The args last seen while rendering; undefined forces a fresh look (after a crash).
  const [seen, setSeen] = useState<PerkFinderArgs | null | undefined>(args);
  if (args !== seen) {
    setSeen(args);
    if (args && answerHere(args)) setLanded({ forArgs: args, result: solve(args) });
  }

  const [slowFor, setSlowFor] = useState<PerkFinderArgs | null>(null);
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  // The args of the latest request posted (seq.current, when it was posted).
  const inFlight = useRef<PerkFinderArgs | null>(null);

  useEffect(() => {
    seq.current++;
    if (!args) {
      worker.current?.terminate();
      worker.current = null;
      busy.current = false;
      return;
    }
    if (broken || typeof Worker === "undefined") return;
    // The solve is synchronous, so terminating is the only way to stop a stale one.
    if (busy.current) {
      worker.current?.terminate();
      worker.current = null;
      busy.current = false;
    }
    if (!worker.current) {
      const w = new Worker(new URL("./perk-finder-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<PerkFinderResponse>) => {
        if (e.data.seq !== seq.current) return;
        busy.current = false;
        setLanded({ forArgs: inFlight.current!, result: e.data.result });
      };
      // Solve on the main thread from here on rather than leave the finder pending forever.
      const fail = () => {
        w.terminate();
        if (worker.current === w) worker.current = null;
        busy.current = false;
        setBroken(true);
        setSeen(undefined);
      };
      w.onerror = fail;
      w.onmessageerror = fail;
      worker.current = w;
    }
    // Answered while rendering; the worker stays warm for the first pick.
    if (nothingPicked(args)) return;
    busy.current = true;
    inFlight.current = args;
    worker.current.postMessage({ seq: seq.current, args } satisfies PerkFinderRequest);
  }, [args, broken]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const pending = args !== null && landed?.forArgs !== args;
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setSlowFor(args), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [pending, args]);

  if (!args) return { result: null, pending: false, slow: false };
  return { result: landed?.result ?? null, pending, slow: pending && slowFor === args };
}
