/**
 * Pure stage model for the full-screen "Loading your armor" screen. Maps the
 * three sequential startup fetches (session → manifest → armory) onto one
 * overall progress target so the bar only ever moves forward.
 */

import type { ManifestStatus } from "../manifest/use-manifest";

/**
 * ManifestStatus, minus the ready payload (the stage model never touches the
 * manifest itself). Derived from the shared union so the variants can't drift.
 */
export type ManifestInput =
  | Exclude<ManifestStatus, { state: "ready" }>
  | Pick<Extract<ManifestStatus, { state: "ready" }>, "state">;

export interface LoadingInputs {
  /** Session query has no result yet (first load / hard refresh). */
  sessionPending: boolean;
  sessionError: boolean;
  authenticated: boolean;
  manifest: ManifestInput;
  /** Armory query has no data yet (covers the gated-but-not-started window). */
  armoryPending: boolean;
  armoryError: boolean;
}

export interface LoadingView {
  /**
   * "loading" keeps the overlay up, "done" triggers the sweep-to-100% and
   * fade-out, "hidden" removes it immediately (signed out, or an error that
   * the inline status cards should surface instead).
   */
  phase: "hidden" | "loading" | "done";
  /** Overall progress target in [0, 1]; smoothed by the component. */
  target: number;
  message: string;
}

// Stage bands: session resolves within [0, 0.08), manifest fills [0.08, 0.78),
// armory sits at 0.9 (the smoothing trickle keeps it inching forward).
const MANIFEST_START = 0.08;
const MANIFEST_END = 0.78;
const ARMORY_TARGET = 0.9;

export function loadingView(inputs: LoadingInputs): LoadingView {
  const { manifest } = inputs;

  if (inputs.sessionError || manifest.state === "error" || inputs.armoryError) {
    return { phase: "hidden", target: 0, message: "" };
  }

  if (inputs.sessionPending) {
    return { phase: "loading", target: 0.04, message: "Checking your session…" };
  }

  if (!inputs.authenticated) {
    return { phase: "hidden", target: 0, message: "" };
  }

  if (manifest.state === "idle" || manifest.state === "loading") {
    const fraction = manifest.state === "loading" ? manifest.progress : 0;
    return {
      phase: "loading",
      target: MANIFEST_START + (MANIFEST_END - MANIFEST_START) * fraction,
      message:
        manifest.state === "loading" ? manifest.message : "Loading game data…",
    };
  }

  if (inputs.armoryPending) {
    return {
      phase: "loading",
      target: ARMORY_TARGET,
      message: "Loading your Guardians' gear…",
    };
  }

  return { phase: "done", target: 1, message: "Armor ready" };
}
