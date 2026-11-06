"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { LOADOUTS_QUERY_KEY, useLoadouts } from "./use-loadouts";
import type { SavedLoadout } from "./types";

// The saved loadout the optimizer was opened from ("Optimize" on /loadouts). While set,
// build cards of its class offer "Update loadout" instead of only saving a new one.
// Kept in localStorage beside the builder's selections, which it describes, so a reload
// keeps it. Only the id, name and class are stored: build cards read just these while
// rendering (one store read each, no query), and take the full row from the loadouts
// cache when clicked.
const KEY = "stat-builder:optimizing-loadout";

export interface OptimizingLoadout {
  id: string;
  name: string;
  /** The loadout's class; 3 = any class. */
  classType: number;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: OptimizingLoadout | null = null;

function parse(raw: string | null): OptimizingLoadout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OptimizingLoadout>;
    return typeof v.id === "string" && typeof v.name === "string" && Number.isInteger(v.classType)
      ? { id: v.id, name: v.name, classType: v.classType! }
      : null;
  } catch {
    return null;
  }
}

function read(): OptimizingLoadout | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: nothing remembered.
  }
  // Same string, same object — useSyncExternalStore needs a stable snapshot.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

/** Remember (or, with null, forget) the loadout the optimizer is working on. */
export function setOptimizingLoadout(saved: SavedLoadout | null): void {
  try {
    if (saved) {
      const value: OptimizingLoadout = {
        id: saved.id,
        name: saved.loadout.name,
        classType: saved.loadout.classType,
      };
      localStorage.setItem(KEY, JSON.stringify(value));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Best-effort, like the selections themselves.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The remembered loadout (id, name, class) — cheap: no query. */
export function useOptimizingLoadoutRef(): OptimizingLoadout | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** The remembered loadout's current row from the loadouts cache, if it still exists. */
export function cachedOptimizingLoadout(
  queryClient: QueryClient,
  ref: OptimizingLoadout | null,
): SavedLoadout | undefined {
  if (!ref) return undefined;
  return queryClient
    .getQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY)
    ?.find((l) => l.id === ref.id);
}

/**
 * The remembered loadout's live row (for its current name), for the one banner that
 * shows it. Forgets a loadout the loaded list no longer has (deleted, other account).
 */
export function useOptimizingLoadout(): SavedLoadout | undefined {
  const ref = useOptimizingLoadoutRef();
  const { data } = useLoadouts();
  const saved = ref && data ? data.find((l) => l.id === ref.id) : undefined;
  const gone = ref !== null && data !== undefined && saved === undefined;
  useEffect(() => {
    if (gone) setOptimizingLoadout(null);
  }, [gone]);
  return saved;
}
