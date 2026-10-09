"use client";

import { useEffect, useRef, useState } from "react";
import { AUTO_SEARCH_DEBOUNCE_MS } from "./use-auto-search";
import type { OptimizerInput } from "./types";
import type { WeaponMixResult } from "./weapon-plan";
import type { WeaponPlanRequest, WeaponPlanResponse } from "./weapon-plan-worker";

export interface WeaponPlanState {
  /** True from the moment the input changes (debounce included) until its scan lands. */
  running: boolean;
  /** The latest scan's mixes; kept on screen (stale) while a newer scan runs. */
  results: WeaponMixResult[] | null;
}

const IDLE: WeaponPlanState = { running: false, results: null };

/**
 * Scan the weapon mixes for `input` whenever its identity changes (the caller memoizes
 * it on everything but the entered weapons, which the scan replaces anyway), debounced
 * like the regular auto-search. `null` = off: nothing runs and the worker is released.
 * A new input mid-scan terminates the worker — the scan is synchronous — so a stale
 * result can't land.
 */
export function useWeaponPlan(input: OptimizerInput | null): WeaponPlanState {
  const [state, setState] = useState<{
    forInput: OptimizerInput | null;
    results: WeaponMixResult[] | null;
  }>({ forInput: null, results: null });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const inFlight = useRef<OptimizerInput | null>(null);

  useEffect(() => {
    if (!input) {
      worker.current?.terminate();
      worker.current = null;
      busy.current = false;
      seq.current++;
      return;
    }
    const t = window.setTimeout(() => {
      if (busy.current) {
        worker.current?.terminate();
        worker.current = null;
      }
      if (!worker.current) {
        const w = new Worker(new URL("./weapon-plan-worker.ts", import.meta.url), {
          type: "module",
        });
        w.onmessage = (e: MessageEvent<WeaponPlanResponse>) => {
          if (e.data.seq !== seq.current) return;
          busy.current = false;
          setState({ forInput: inFlight.current, results: e.data.results });
        };
        // A crash would leave `running` true forever: settle with no suggestions and
        // drop the worker so the next scan starts a fresh one.
        const fail = () => {
          busy.current = false;
          w.terminate();
          if (worker.current === w) worker.current = null;
          setState({ forInput: inFlight.current, results: null });
        };
        w.onerror = fail;
        w.onmessageerror = fail;
        worker.current = w;
      }
      const s = ++seq.current;
      busy.current = true;
      inFlight.current = input;
      worker.current.postMessage({ seq: s, input } satisfies WeaponPlanRequest);
    }, AUTO_SEARCH_DEBOUNCE_MS);
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
  return { running: state.forInput !== input, results: state.results };
}
