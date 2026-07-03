"use client";

import {
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { loadManifest, type Manifest } from "./load";

export type ManifestStatus =
  | { state: "idle" }
  | { state: "loading"; message: string; progress: number }
  | { state: "ready"; manifest: Manifest }
  | { state: "error"; message: string };

interface ManifestProgress {
  message: string;
  progress: number;
}

const MANIFEST_KEY = ["manifest"];
const PROGRESS_KEY = ["manifest-progress"];

/**
 * Loads the Destiny manifest once per page session via the shared query cache,
 * so every subscriber sees the same status and download progress. Gated on an
 * authenticated session: signed-out visitors never fetch game data.
 */
export function useManifest(): ManifestStatus {
  const session = useSession();
  const enabled = Boolean(session.data?.authenticated);
  const queryClient = useQueryClient();

  // Subscribe-only view of download progress; written from the query function.
  const progress = useQuery<ManifestProgress>({
    queryKey: PROGRESS_KEY,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const manifest = useQuery<Manifest>({
    queryKey: MANIFEST_KEY,
    enabled,
    // The manifest is version-stamped and immutable for the page session:
    // never refetch, never garbage-collect. A failed load surfaces as an
    // error status and refetches on the next mount.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: () =>
      loadManifest((message, fraction) => {
        queryClient.setQueryData<ManifestProgress>(PROGRESS_KEY, {
          message,
          progress: fraction,
        });
      }),
  });

  if (manifest.data) return { state: "ready", manifest: manifest.data };
  if (manifest.isError) {
    const err = manifest.error;
    return {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (manifest.isFetching) {
    return {
      state: "loading",
      message: progress.data?.message ?? "Loading manifest…",
      progress: progress.data?.progress ?? 0,
    };
  }
  return { state: "idle" };
}
