"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import { fetchInGameLoadouts, inGameLoadoutsKey, InGameLoadoutsError } from "./ingame-save";

/**
 * A character's in-game loadout slots, for the dialogs that show them. Always refetched
 * and never kept once closed: the slots are whatever the game holds right now, and a
 * pick there decides what gets overwritten or deleted. A load that finds the session
 * gone signs out.
 */
export function useInGameLoadouts(characterId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: inGameLoadoutsKey(characterId),
    queryFn: () => fetchInGameLoadouts(characterId!),
    enabled: enabled && !!characterId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const reauth = query.error instanceof InGameLoadoutsError && query.error.reauth;
  useEffect(() => {
    if (reauth) void handleSessionExpired(queryClient);
  }, [reauth, queryClient]);
  return query;
}
