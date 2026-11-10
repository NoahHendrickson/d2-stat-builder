"use client";

import { useEffect, useState } from "react";

/** Trailing-edge delay between a burst edit (a drag, typing) and the search it triggers. */
export const AUTO_SEARCH_DEBOUNCE_MS = 250;

/** What a control tells the auto-search about the edit it is making. */
export interface AutoSearchControls {
  /**
   * The next change is part of a burst (a slider moving, a key typed in a number box,
   * slider arrow keys): debounce its search. Call it just before applying the edit.
   */
  burst(): void;
  /** The burst is over (pointer released, Enter, blur): search now if one is waiting. */
  commit(): void;
}

export interface AutoSearchPolicy extends AutoSearchControls {
  /** A new `search` identity (or `enabled` flip), from the hook's effect. */
  change(enabled: boolean, search: () => void): void;
  /** Cancel a waiting search (unmount). */
  dispose(): void;
}

interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

const windowTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

/**
 * Auto-search policy, framework-free so it can be tested on its own. `change` receives
 * the caller's `search` whenever its identity changes (the caller memoizes it on exactly
 * the build inputs, so a new identity means "something changed").
 *
 * - The first change after `enabled` becomes true runs at once: the data just became
 *   ready and nothing is being edited. Dropping `enabled` (sign-out, a refresh in
 *   flight, another tab) resets the policy, so the next readiness runs at once too.
 * - A change marked with `burst()` waits AUTO_SEARCH_DEBOUNCE_MS (each further burst
 *   change restarts the wait), so a slider drag or typing searches once it pauses.
 * - Every other change (a tick, a toggle, a pick, a Reset) searches at once and drops
 *   any waiting burst search, which it supersedes.
 * - `commit()` runs a waiting burst search now. It also clears an unconsumed burst
 *   mark, so a release that lands before the last drag step's effect has run still
 *   searches that last step at once.
 */
export function createAutoSearchPolicy(timers: Timers = windowTimers): AutoSearchPolicy {
  let enabled = false;
  let hasRun = false;
  let burstMark = false;
  let timer: number | null = null;
  let waiting: (() => void) | null = null;

  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    waiting = null;
  };
  const runNow = (search: () => void) => {
    cancel();
    search();
  };

  return {
    change(nextEnabled, search) {
      enabled = nextEnabled;
      if (!enabled) {
        hasRun = false;
        burstMark = false;
        cancel();
        return;
      }
      if (!hasRun) {
        hasRun = true;
        burstMark = false;
        runNow(search);
        return;
      }
      if (!burstMark) {
        runNow(search);
        return;
      }
      burstMark = false;
      cancel();
      waiting = search;
      timer = timers.set(() => {
        timer = null;
        waiting = null;
        search();
      }, AUTO_SEARCH_DEBOUNCE_MS);
    },
    burst() {
      // A burst on a paused policy (the other tab's sliders) must not linger and
      // debounce the first edit after it resumes.
      if (enabled) burstMark = true;
    },
    commit() {
      burstMark = false;
      const search = waiting;
      if (search) runNow(search);
    },
    dispose() {
      burstMark = false;
      cancel();
    },
  };
}

/**
 * Run `search` whenever its identity changes while `enabled` (see createAutoSearchPolicy).
 * Returns stable controls for burst edits; edits that don't use them search at once.
 */
export function useAutoSearch(enabled: boolean, search: () => void): AutoSearchControls {
  const [policy] = useState(() => createAutoSearchPolicy());
  useEffect(() => {
    policy.change(enabled, search);
  }, [policy, enabled, search]);
  useEffect(() => () => policy.dispose(), [policy]);
  return policy;
}
