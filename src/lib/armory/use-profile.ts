"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { useSession, type SessionState } from "@/lib/auth/use-session";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import { ArmoryError, fetchProfile } from "./fetch";
import { profileKey } from "./keys";

export const isSessionExpired = (error: unknown): boolean =>
  error instanceof ArmoryError && error.status === 401;

/** The signed-in account's id (Bungie.net membership), or undefined when signed out. */
export function sessionMembershipId(session: SessionState | undefined): string | undefined {
  return session?.authenticated ? session.user?.membershipId : undefined;
}

/**
 * The signed-in player's raw Destiny profile, fetched as soon as the session is known —
 * it does not wait for the manifest, so the two longest startup legs overlap.
 * `useArmory` normalizes it once the manifest is ready.
 */
export function useProfile() {
  const session = useSession();
  const membershipId = sessionMembershipId(session.data);
  const queryClient = useQueryClient();

  const query = useQuery<DestinyProfileResponse>({
    queryKey: profileKey(membershipId),
    enabled: membershipId !== undefined,
    staleTime: 5 * 60_000,
    queryFn: fetchProfile,
    // Every response is a new profile (timestamps move); deep-diffing a multi-MB
    // payload to preserve identity would only cost time.
    structuralSharing: false,
    // A 401 means the server already cleared the dead session — retrying can't succeed.
    retry: (failureCount, error) => !isSessionExpired(error) && failureCount < 3,
  });

  // On session expiry the server has already cleared the cookies: drop the local data
  // and refetch the session query so it flips to unauthenticated and the existing
  // sign-in card becomes the re-auth prompt.
  const sessionExpired = isSessionExpired(query.error);
  useEffect(() => {
    if (sessionExpired) void handleSessionExpired(queryClient);
  }, [sessionExpired, queryClient]);

  return { query, membershipId };
}
