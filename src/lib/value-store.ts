"use client";

import { useSyncExternalStore } from "react";

/**
 * A minimal external store for a single value that changes far more often than the
 * React tree should re-render (per-frame progress, per-message worker updates).
 * Components that need the live value subscribe with `useStoreValue`; everything
 * else stays untouched.
 */
export interface ValueStore<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to a store's value (re-renders only that component). */
export function useStoreValue<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
