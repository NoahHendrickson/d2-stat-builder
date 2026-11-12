"use client";

import { useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useProfile } from "@/lib/armory/use-profile";
import { handleSessionExpired } from "@/lib/auth/sign-out";
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
 * The player's crafting pattern progress by weapon name: a separate Bungie call, made
 * when a panel needs it so the profile poll stays light. It is keyed on the profile's
 * snapshot, so an extraction the poll picks up shows on the next panel (the old counts
 * stay up while it loads). A load that finds the session gone signs out. `enabled`
 * false holds off the call (Weapon search loads it only for a `pattern:` search).
 */
export function usePatterns(enabled = true) {
  const { query: profile, membershipId } = useProfile();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["patterns", membershipId, profile.data?.responseMintedTimestamp],
    queryFn: fetchPatterns,
    enabled: enabled && membershipId !== undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => !isReauth(error) && failureCount < 1,
  });
  const reauth = isReauth(query.error);
  useEffect(() => {
    if (reauth) void handleSessionExpired(queryClient);
  }, [reauth, queryClient]);
  return query;
}
