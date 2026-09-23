"use client";

import { useCallback } from "react";
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { SessionState } from "@/lib/auth/use-session";
import type { Manifest } from "@/lib/manifest/load";
import { MANIFEST_KEY, useManifest } from "@/lib/manifest/use-manifest";
import { readArmoryCache, writeArmoryCache, type ArmoryCacheEntry } from "./armory-cache";
import { deriveArmory, type Armory } from "./fetch";
import { ARMORY_KEY, armoryCacheKey, armoryKey } from "./keys";
import { sessionMembershipId, useProfile } from "./use-profile";

export interface RefreshResult {
  data?: Armory;
  error: unknown;
  isSuccess: boolean;
}

/**
 * The armory query result. `refetch` is the one departure from a plain query result:
 * it refetches the PROFILE from Bungie (re-deriving the armory from the profile already
 * in memory would make "Refresh gear" a no-op) and resolves with the profile's real
 * outcome plus the re-normalized armory.
 */
export type ArmoryQuery = Omit<UseQueryResult<Armory>, "refetch"> & {
  refetch: () => Promise<RefreshResult>;
};

/** Run `fn` when the browser is idle (the write is a structured clone of the whole armory). */
const whenIdle = (fn: () => void): void => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 5000 });
  else setTimeout(fn, 1000);
};

/**
 * The signed-in player's normalized armor, as a query derived from the raw profile and
 * the manifest (both fetched independently) — keyed on the account, the manifest
 * version, and the profile fetch, so a new profile re-derives and everything keyed on
 * the armory follows. The persisted copy from a previous visit is served as
 * `placeholderData` (same manifest version, inside the TTL) until the live profile
 * lands; `isPlaceholderData` is true then, and while a refetch re-derives. Placeholder
 * data never enters the query cache, which is what keeps `peekArmory` live-only.
 */
export function useArmory(): ArmoryQuery {
  const { query: profile, membershipId } = useProfile();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const version = manifest?.version;

  const cached = useQuery<ArmoryCacheEntry | null>({
    queryKey: armoryCacheKey(membershipId),
    enabled: membershipId !== undefined,
    queryFn: () => readArmoryCache(membershipId as string),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const placeholder =
    cached.data && cached.data.manifestVersion === version ? cached.data.armory : undefined;

  const profileData = profile.data;
  const query = useQuery<Armory>({
    queryKey: armoryKey(membershipId, version, profile.dataUpdatedAt),
    enabled: Boolean(membershipId && manifest && profileData),
    queryFn: () => {
      const armory = deriveArmory(
        profileData as DestinyProfileResponse,
        manifest as Manifest,
      );
      const id = membershipId as string;
      const manifestVersion = version as string;
      whenIdle(() => {
        void writeArmoryCache(id, { manifestVersion, savedAt: Date.now(), armory });
      });
      return armory;
    },
    // While a refetch re-derives, keep the previous armory on screen; before the first
    // live derivation, last visit's copy.
    placeholderData: (previous) => previous ?? placeholder,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  const profileRefetch = profile.refetch;
  const refetch = useCallback<ArmoryQuery["refetch"]>(async () => {
    const result = await profileRefetch();
    const data = result.data && manifest ? deriveArmory(result.data, manifest) : undefined;
    return { data, error: result.error, isSuccess: result.isSuccess };
  }, [profileRefetch, manifest]);

  // The network state is the profile's: the derived query itself never fails or
  // waits on the network, so a profile error would otherwise read as "still pending".
  return {
    ...query,
    isFetching: query.isFetching || profile.isFetching,
    isError: query.isError || profile.isError,
    error: query.error ?? profile.error,
    refetch,
  };
}

/**
 * Non-subscribing read of the LIVE armory (derived from a fetched profile against the
 * current manifest) for click-time reads that must not observe the query — and must
 * not act on last visit's gear: placeholder data is never in the cache, so a
 * provisional armory reads as undefined here.
 */
export function peekArmory(queryClient: QueryClient): Armory | undefined {
  const membershipId = sessionMembershipId(queryClient.getQueryData<SessionState>(["session"]));
  const version = queryClient.getQueryData<Manifest>(MANIFEST_KEY)?.version;
  if (!membershipId || !version) return undefined;
  let newest: { at: number; data: Armory } | undefined;
  for (const [key, data] of queryClient.getQueriesData<Armory>({
    queryKey: [ARMORY_KEY, membershipId, version],
  })) {
    const at = key[3] as number;
    if (data && (!newest || at > newest.at)) newest = { at, data };
  }
  return newest?.data;
}
