"use client";

import { useQuery } from "@tanstack/react-query";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { useSession } from "@/lib/auth/use-session";
import type { PatternsResponse } from "./patterns";

async function fetchPatterns(): Promise<PatternsResponse["patterns"]> {
  const res = await fetch("/api/bungie/patterns");
  const data = (await res.json().catch(() => null)) as (Partial<PatternsResponse> & { error?: string }) | null;
  if (!res.ok || !data?.patterns) throw new Error(data?.error ?? "Couldn't load your pattern progress");
  return data.patterns;
}

/**
 * The player's crafting pattern progress by weapon name, loaded the first time a panel
 * asks for it (a separate Bungie call, so the profile poll stays light) and refreshed
 * when asked again a few minutes later.
 */
export function usePatterns(enabled: boolean) {
  const membershipId = sessionMembershipId(useSession().data);
  return useQuery({
    queryKey: ["patterns", membershipId],
    queryFn: fetchPatterns,
    enabled: enabled && membershipId !== undefined,
    staleTime: 3 * 60_000,
    retry: 1,
  });
}
