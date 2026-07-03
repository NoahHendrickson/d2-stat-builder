"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { useManifest } from "@/lib/manifest/use-manifest";
import { ArmoryError, fetchArmory } from "./fetch";

const isSessionExpired = (error: unknown): boolean =>
  error instanceof ArmoryError && error.status === 401;

/**
 * Loads + normalizes the signed-in player's armor (via the /api/bungie/profile
 * server proxy). Gated on an authenticated session and a ready manifest.
 */
export function useArmory() {
  const session = useSession();
  const manifestStatus = useManifest();
  const queryClient = useQueryClient();
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  const enabled = Boolean(session.data?.authenticated && manifest);

  const query = useQuery({
    queryKey: ["armory", manifest?.version],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => fetchArmory(manifest!),
    // A 401 means the server already cleared the dead session — retrying can't succeed.
    retry: (failureCount, error) =>
      !isSessionExpired(error) && failureCount < 3,
  });

  // On session expiry, refetch the session query: cookies are cleared server-side, so it
  // flips to unauthenticated and the existing sign-in card becomes the re-auth prompt.
  const sessionExpired = isSessionExpired(query.error);
  useEffect(() => {
    if (sessionExpired) {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    }
  }, [sessionExpired, queryClient]);

  return query;
}
