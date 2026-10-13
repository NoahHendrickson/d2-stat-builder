"use client";

import { useCallback, useState, type SetStateAction } from "react";
import type { BuildsMode } from "@/components/builder/builds-column-content";

/** Which tab's value a write goes to; "both" for changes that void either one (class). */
export type TabTarget = BuildsMode | "both";

/**
 * A builder input that Builds and Theoretical Builds keep separately: each tab edits its
 * own value, and switching tabs swaps which one the controls show. `set` writes to the
 * tab that was open when it was created; `setIn` names the tab.
 */
export function useTabInput<T>(
  mode: BuildsMode,
  initialActual: () => T,
  initialTheoretical: () => T,
) {
  const [values, setValues] = useState<Record<BuildsMode, T>>(() => ({
    actual: initialActual(),
    theoretical: initialTheoretical(),
  }));
  const setIn = useCallback(
    (target: TabTarget, next: SetStateAction<T>) =>
      setValues((prev) => {
        const resolve = (cur: T) =>
          typeof next === "function" ? (next as (cur: T) => T)(cur) : next;
        const actual = target === "theoretical" ? prev.actual : resolve(prev.actual);
        const theoretical =
          target === "actual" ? prev.theoretical : resolve(prev.theoretical);
        // Unchanged values keep the state object: no re-render, no new search.
        return Object.is(actual, prev.actual) && Object.is(theoretical, prev.theoretical)
          ? prev
          : { actual, theoretical };
      }),
    [],
  );
  const set = useCallback(
    (next: SetStateAction<T>) => setIn(mode, next),
    [mode, setIn],
  );
  return { value: values[mode], actual: values.actual, set, setIn };
}
