"use client";

import { useEffect } from "react";

// Stops the player leaving a screen with unsaved work. The screen registers how to ask;
// anything that navigates goes through `leaveOrAsk`. A module rather than a context
// because only one screen can be holding unsaved work at a time.

type AskToLeave = (go: () => void) => void;

let ask: AskToLeave | null = null;

/** Run `go` now, or hand it to the screen with unsaved work, which runs it if they discard. */
export function leaveOrAsk(go: () => void): void {
  if (ask) ask(go);
  else go();
}

/** Whether leaving would have to ask first. */
export function hasUnsavedChanges(): boolean {
  return ask !== null;
}

/**
 * While `unsaved`, in-app navigation calls `askToLeave` (keep it stable) instead of going,
 * and the browser warns before a reload or closing the tab. The browser's back button
 * isn't caught, so keep the work somewhere that survives the screen unmounting.
 */
export function useUnsavedChangesGuard(unsaved: boolean, askToLeave: AskToLeave): void {
  useEffect(() => {
    if (!unsaved) return;
    ask = askToLeave;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      ask = null;
      window.removeEventListener("beforeunload", warn);
    };
  }, [unsaved, askToLeave]);
}
