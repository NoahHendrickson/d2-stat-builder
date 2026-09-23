"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth/use-session";
import { useManifest } from "@/lib/manifest/use-manifest";
import { getOptimizerStore } from "./optimizer-store";

/**
 * Spawn the solver worker before the first search needs it — but only once the player
 * is signed in and the manifest is in (from cache or downloaded): a signed-out visitor
 * never searches, and on a cold load the worker chunk would otherwise compete with the
 * manifest parse and the profile request for the startup window this is meant to shorten.
 */
export function useOptimizerWarmup(): void {
  const session = useSession();
  const manifest = useManifest();
  const enabled = Boolean(session.data?.authenticated) && manifest.state === "ready";
  useEffect(() => {
    if (enabled) getOptimizerStore().warm();
  }, [enabled]);
}
