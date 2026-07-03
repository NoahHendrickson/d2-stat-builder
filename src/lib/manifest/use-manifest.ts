"use client";

import { useEffect, useState } from "react";
import { loadManifest, type Manifest } from "./load";

export type ManifestStatus =
  | { state: "idle" }
  | { state: "loading"; message: string; progress: number }
  | { state: "ready"; manifest: Manifest }
  | { state: "error"; message: string };

// Load once per page session; share across components. Progress is broadcast to
// every mounted hook instance (not just the one that kicked off the load), with
// the latest loading snapshot kept for subscribers that mount mid-download.
let cachedManifest: Manifest | null = null;
let inflight: Promise<Manifest> | null = null;
let lastLoading = { message: "Loading manifest…", progress: 0 };
const listeners = new Set<(status: ManifestStatus) => void>();

function broadcast(status: ManifestStatus) {
  if (status.state === "loading") {
    lastLoading = { message: status.message, progress: status.progress };
  }
  for (const listener of listeners) listener(status);
}

/**
 * Pass `enabled: false` to subscribe without kicking off the download (the
 * load starts once some mounted subscriber is enabled — e.g. after the session
 * resolves as authenticated, so signed-out visitors never fetch game data).
 */
export function useManifest(enabled = true): ManifestStatus {
  const [status, setStatus] = useState<ManifestStatus>(() =>
    cachedManifest
      ? { state: "ready", manifest: cachedManifest }
      : { state: "idle" },
  );

  useEffect(() => {
    if (!enabled) return;
    if (cachedManifest) {
      setStatus({ state: "ready", manifest: cachedManifest });
      return;
    }

    const listener = setStatus;
    listeners.add(listener);

    if (!inflight) {
      lastLoading = { message: "Loading manifest…", progress: 0 };
      inflight = loadManifest((message, progress) => {
        broadcast({ state: "loading", message, progress });
      });
      inflight
        .then((manifest) => {
          cachedManifest = manifest;
          inflight = null;
          broadcast({ state: "ready", manifest });
        })
        .catch((err: unknown) => {
          inflight = null;
          broadcast({
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    }
    setStatus({ state: "loading", ...lastLoading });

    return () => {
      listeners.delete(listener);
    };
  }, [enabled]);

  return status;
}
