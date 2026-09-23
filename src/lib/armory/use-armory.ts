"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { SessionState } from "@/lib/auth/use-session";
import type { Manifest } from "@/lib/manifest/load";
import { useManifest } from "@/lib/manifest/use-manifest";
import { readArmoryCache, writeArmoryCache, type ArmoryCacheEntry } from "./armory-cache";
import { deriveArmory, type Armory } from "./fetch";
import { profileKey, sessionMembershipId, useProfile } from "./use-profile";

export interface ArmoryQuery {
  data: Armory | undefined;
  /** `data` is last visit's copy from IndexedDB; the live profile is still loading. */
  isPlaceholderData: boolean;
  /** No armory at all yet (live or cached) and no error. */
  isPending: boolean;
  isLoading: boolean;
  /** The live profile is being (re)fetched. */
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** Refetch the live profile; resolves with the re-normalized armory. */
  refetch: () => Promise<{ data?: Armory; error: unknown; isSuccess: boolean }>;
}

const cacheKey = (membershipId: string | undefined) =>
  ["armory-cache", membershipId] as const;

// Armories already written to IndexedDB, so the (many) subscribers write each once.
const written = new WeakSet<Armory>();

/**
 * The signed-in player's normalized armor. Derived from the raw profile and the
 * manifest (both fetched independently), and persisted per account so a returning
 * player gets last visit's armory the moment the manifest is ready — the live profile
 * replaces it when it lands.
 */
export function useArmory(): ArmoryQuery {
  const { query: profile, membershipId } = useProfile();
  const manifestStatus = useManifest();
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  const live = useMemo(
    () => (profile.data && manifest ? deriveArmory(profile.data, manifest) : undefined),
    [profile.data, manifest],
  );

  const cached = useQuery<ArmoryCacheEntry | null>({
    queryKey: cacheKey(membershipId),
    enabled: membershipId !== undefined && live === undefined,
    queryFn: () => readArmoryCache(membershipId as string),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!live || !manifest || !membershipId || written.has(live)) return;
    written.add(live);
    void writeArmoryCache(membershipId, {
      manifestVersion: manifest.version,
      savedAt: Date.now(),
      armory: live,
    });
  }, [live, manifest, membershipId]);

  const placeholder =
    !live && manifest && cached.data?.manifestVersion === manifest.version
      ? cached.data.armory
      : undefined;
  const data = live ?? placeholder;

  const profileRefetch = profile.refetch;
  const refetch = useCallback<ArmoryQuery["refetch"]>(async () => {
    const result = await profileRefetch();
    const armory = result.data && manifest ? deriveArmory(result.data, manifest) : undefined;
    return { data: armory, error: result.error, isSuccess: armory !== undefined };
  }, [profileRefetch, manifest]);

  const isPending = data === undefined && !profile.isError;
  return {
    data,
    isPlaceholderData: data !== undefined && live === undefined,
    isPending,
    isLoading: isPending,
    isFetching: profile.isFetching,
    isError: profile.isError,
    error: profile.error,
    refetch,
  };
}

/**
 * Non-subscribing read of the current armory (live if derivable, else the cached copy),
 * for click-time reads from components that must not observe the profile query.
 */
export function peekArmory(queryClient: QueryClient): Armory | undefined {
  const session = queryClient.getQueryData<SessionState>(["session"]);
  const membershipId = sessionMembershipId(session);
  if (!membershipId) return undefined;
  const profile = queryClient.getQueryData<DestinyProfileResponse>(profileKey(membershipId));
  const manifest = queryClient.getQueryData<Manifest>(["manifest"]);
  if (profile && manifest) return deriveArmory(profile, manifest);
  return queryClient.getQueryData<ArmoryCacheEntry | null>(cacheKey(membershipId))?.armory;
}
