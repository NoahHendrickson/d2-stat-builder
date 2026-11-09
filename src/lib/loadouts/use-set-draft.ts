"use client";

import { createStore, useStore } from "../create-store";
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
const store = createStore(NOTHING);

export function useSetDraft(): SetDraftState {
  return useStore(store, NOTHING);
}

/** Start editing a new draft, or drop the current one with null. */
export function replaceSetDraft(draft: SetDraft | null): void {
  store.set({ ...store.get(), draft });
}

/** Change `set`'s working copy, starting one if it isn't already being edited. */
export function changeSetDraft(set: ActivitySet, change: (draft: SetDraft) => SetDraft): void {
  const state = store.get();
  const current = state.draft?.set.id === set.id ? state.draft : draftFromSet(set);
  store.set({ ...state, draft: change(current) });
}

export function setSetDraftSaving(saving: boolean): void {
  store.set({ ...store.get(), saving });
}
