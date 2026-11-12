"use client";

import { useEffect } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { profileKey } from "@/lib/armory/keys";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import { useSession } from "@/lib/auth/use-session";
import type { PatternsResponse } from "./patterns";

/** A failed load; `reauth` when the server has already cleared a dead session. */
class PatternsError extends Error {
  constructor(
    message: string,
    readonly reauth: boolean,
  ) {
    super(message);
  }
}

async function fetchPatterns(): Promise<PatternsResponse["patterns"]> {
  const res = await fetch("/api/bungie/patterns");
  const data = (await res.json().catch(() => null)) as
    | (Partial<PatternsResponse> & { error?: string; reauth?: boolean })
    | null;
  if (!res.ok || !data?.patterns) {
    throw new PatternsError(data?.error ?? "Couldn't load your pattern progress", data?.reauth === true);
  }
  return data.patterns;
}

const isReauth = (error: unknown) => error instanceof PatternsError && error.reauth;

/**
 * The held profile's snapshot stamp, without fetching it or re-rendering for anything
 * else in it (the profile query keeps no structural sharing, so a whole-profile
 * subscription re-renders on every refetch).
 */
function useProfileStamp(membershipId: string | undefined): string | undefined {
  return useQuery({
    queryKey: profileKey(membershipId),
    queryFn: skipToken,
    select: (profile: DestinyProfileResponse) => profile.responseMintedTimestamp,
  }).data;
}

/**
 * The player's crafting pattern progress by weapon name: a separate Bungie call, made
 * when a panel needs it so the profile poll stays light. It is keyed on the profile's
 * snapshot, so an extraction the poll picks up shows on the next panel (the same
 * account's old counts stay up while it loads). A load that finds the session gone
 * signs out. `enabled` false holds off the call (Weapon search loads it only for a
 * `pattern:` search).
 */
export function usePatterns(enabled = true) {
  const membershipId = sessionMembershipId(useSession().data);
  const stamp = useProfileStamp(membershipId);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["patterns", membershipId, stamp],
    queryFn: fetchPatterns,
    enabled: enabled && membershipId !== undefined,
    staleTime: Infinity,
    // Never another account's counts (a session that expired, or a switch).
    placeholderData: (previous, previousQuery) =>
      membershipId !== undefined && previousQuery?.queryKey[1] === membershipId ? previous : undefined,
    retry: (failureCount, error) => !isReauth(error) && failureCount < 1,
  });
  const reauth = isReauth(query.error);
  useEffect(() => {
    if (reauth) void handleSessionExpired(queryClient);
  }, [reauth, queryClient]);
  return query;
}
