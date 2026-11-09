"use client";

import { useSyncExternalStore } from "react";
import type { ActivitySet } from "./activity-sets";
import { draftFromSet, type SetDraft } from "./set-draft";

// The activity set being edited. It lives in this module (not a component) so unsaved
// work survives the view unmounting, as the browser's back button does without asking.

interface SetDraftState {
  draft: SetDraft | null;
  /** Save is writing the draft's copies. */
  saving: boolean;
}

const NOTHING: SetDraftState = { draft: null, saving: false };
let state = NOTHING;
const listeners = new Set<() => void>();

function setState(next: SetDraftState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSetDraft(): SetDraftState {
  return useSyncExternalStore(subscribe, () => state, () => NOTHING);
}

/** Start editing a new draft, or drop the current one with null. */
export function replaceSetDraft(draft: SetDraft | null): void {
  setState({ ...state, draft });
}

/** Change `set`'s working copy, starting one if it isn't already being edited. */
export function changeSetDraft(set: ActivitySet, change: (draft: SetDraft) => SetDraft): void {
  const current = state.draft?.set.id === set.id ? state.draft : draftFromSet(set);
  setState({ ...state, draft: change(current) });
}

export function setSetDraftSaving(saving: boolean): void {
  setState({ ...state, saving });
}
