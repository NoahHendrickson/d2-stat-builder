"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { SessionState } from "@/lib/auth/use-session";
import type { Manifest } from "@/lib/manifest/load";
import { MANIFEST_KEY, useManifest } from "@/lib/manifest/use-manifest";
import { persistArmoryWhenIdle, readArmoryCache, type ArmoryCacheEntry } from "./armory-cache";
import { deriveArmory, type Armory } from "./fetch";
import { ARMORY_KEY, armoryCacheKey, armoryKey } from "./keys";
import { sessionMembershipId, useProfile } from "./use-profile";

export interface RefreshResult {
  data?: Armory;
  error: unknown;
  isSuccess: boolean;
}

/**
 * The armory query result, with the network state of the profile it derives from
 * (`isPending`/`isLoading`/`isFetching`/`isError`/`error` reflect the profile fetch —
 * the derived query itself never touches the network), plus:
 * - `isProvisional`: the data on screen is last visit's copy from IndexedDB and no live
 *   profile has been normalized yet this session. (`isPlaceholderData` is also true
 *   while a refetch re-derives and the previous LIVE armory is kept on screen — that
 *   is not provisional, and nothing should be hidden or gated for it.)
 * - `refetch`: refetches the PROFILE from Bungie (re-deriving from the profile already
 *   in memory would make "Refresh gear" a no-op) and resolves with its real outcome
 *   plus the re-normalized armory.
 */
export type ArmoryQuery = Omit<UseQueryResult<Armory>, "refetch"> & {
  isProvisional: boolean;
  refetch: () => Promise<RefreshResult>;
};

/**
 * Superseded derivations (older profile fetches, an older manifest) go inactive when the
 * observer moves to the new key and are collected after this — only the current armory
 * needs to live on.
 */
const SUPERSEDED_ARMORY_GC_MS = 60_000;

/**
 * The signed-in player's normalized armor, as a query derived from the raw profile and
 * the manifest (both fetched independently) — keyed on the account, the manifest
 * version, and the profile fetch, so a new profile re-derives and everything keyed on
 * the armory follows. The persisted copy from a previous visit is served as
 * `placeholderData` (same manifest version, inside the TTL) until the first live
 * profile lands. Placeholder data never enters the query cache, which is what keeps
 * `peekArmory` live-only.
 */
export function useArmory(): ArmoryQuery {
  const { query: profile, membershipId } = useProfile();
  const queryClient = useQueryClient();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const version = manifest?.version;

  const cached = useQuery<ArmoryCacheEntry | null>({
    queryKey: armoryCacheKey(membershipId),
    enabled: membershipId !== undefined,
    queryFn: () => readArmoryCache(membershipId as string),
    staleTime: Infinity,
    gcTime: SUPERSEDED_ARMORY_GC_MS,
    retry: false,
  });
  const fromDisk =
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
      persistArmoryWhenIdle(membershipId as string, {
        manifestVersion: version as string,
        savedAt: Date.now(),
        armory,
      });
      return armory;
    },
    // While a refetch re-derives, keep the previous armory on screen; before the first
    // live derivation, last visit's copy.
    placeholderData: (previous) => previous ?? fromDisk,
    staleTime: Infinity,
    gcTime: SUPERSEDED_ARMORY_GC_MS,
    retry: false,
  });

  // Provisional = placeholder AND no live derivation for this account in the cache.
  // While a refetch re-derives, the previous key's query still holds the last LIVE
  // armory (it is collected only a minute after going inactive), so the placeholder
  // shown then is not provisional. Placeholder data itself is never in the cache.
  const isProvisional =
    query.isPlaceholderData &&
    !queryClient
      .getQueriesData<Armory>({ queryKey: [ARMORY_KEY, membershipId] })
      .some(([, data]) => data !== undefined);

  const profileRefetch = profile.refetch;
  const refetch = useCallback<ArmoryQuery["refetch"]>(async () => {
    const result = await profileRefetch();
    const data = result.data && manifest ? deriveArmory(result.data, manifest) : undefined;
    return { data, error: result.error, isSuccess: result.isSuccess };
  }, [profileRefetch, manifest]);

  // The derived query is disabled (not pending, not fetching) while the profile is
  // still on its way; without this the status card would read "idle" for the whole
  // profile round trip on a cold load.
  const waitingOnProfile = query.data === undefined && !profile.isError && !profile.data;
  return {
    ...query,
    isPending: query.isPending || waitingOnProfile,
    isLoading: query.isLoading || (waitingOnProfile && profile.isFetching),
    isFetching: query.isFetching || profile.isFetching,
    isError: query.isError || profile.isError,
    error: query.error ?? profile.error,
    isProvisional,
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
