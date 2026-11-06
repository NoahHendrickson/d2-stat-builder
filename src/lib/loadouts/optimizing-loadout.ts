"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLoadouts } from "./use-loadouts";
import type { SavedLoadout } from "./types";

// The saved loadout the optimizer is linked to ("Optimize" on /loadouts). While linked,
// builds of its class offer "Update loadout" for it. Only the id is stored, in
// localStorage beside the builder's selections (which it describes), so a reload keeps
// it. It is per browser on purpose: the link is "what I'm optimizing here, now". The
// row itself is read once, by the optimizer page (useOptimizingLoadout), and passed
// down, so its name and class are always the live ones.
const KEY = "stat-builder:optimizing-loadout";

const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
// One window listener for every subscriber: another tab linked or unlinked.
const onStorage = (e: StorageEvent) => {
  if (e.key === KEY) notify();
};

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Link (or, with null, unlink) the loadout the optimizer is working on. */
export function setOptimizingLoadout(saved: SavedLoadout | null): void {
  try {
    if (saved) localStorage.setItem(KEY, saved.id);
    else localStorage.removeItem(KEY);
  } catch {
    // Best-effort, like the selections themselves.
  }
  notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** True when builds of `classType` can update `saved` (any-class loadouts take every class). */
export function linksToClass(saved: SavedLoadout, classType: number | null): boolean {
  const own = saved.loadout.classType;
  return own === 3 || own === classType;
}

/**
 * The linked loadout's live row, or undefined: none linked, the list isn't loaded (signed
 * out, still loading, or failed), or the loaded list no longer has it — then the link
 * is dropped. Until it resolves, builds simply offer Save as loadout.
 */
export function useOptimizingLoadout(): SavedLoadout | undefined {
  const id = useSyncExternalStore(subscribe, read, () => null);
  const { data } = useLoadouts();
  const saved = id && data ? data.find((l) => l.id === id) : undefined;
  const gone = id !== null && data !== undefined && saved === undefined;
  useEffect(() => {
    if (gone) setOptimizingLoadout(null);
  }, [gone]);
  return saved;
}
