"use client";

import { useSyncExternalStore } from "react";

// A value kept outside React, for state that has to outlive the component showing it
// (a run that keeps going after the page is left, a draft the back button mustn't lose).

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The store's value, re-rendering when it changes. `serverValue` is used while hydrating. */
export function useStore<T>(store: Store<T>, serverValue: T): T {
  return useSyncExternalStore(store.subscribe, store.get, () => serverValue);
}
