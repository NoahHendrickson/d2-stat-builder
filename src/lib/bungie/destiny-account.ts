import { getLinkedProfiles } from "bungie-api-ts/destiny2";
import type { HttpClient } from "bungie-api-ts/http";

/** BungieMembershipType.BungieNext — lets GetLinkedProfiles start from the bungie.net id. */
const BUNGIE_NEXT = 254;

/** ErrorCode 1601: no Destiny 2 profile for that membership id + type. */
export const DESTINY_ACCOUNT_NOT_FOUND = 1601;

export interface DestinyAccount {
  membershipId: string;
  membershipType: number;
}

/**
 * The Destiny 2 account to load for a bungie.net user. GetMembershipsForCurrentUser
 * also lists memberships with no D2 profile (Destiny 1-only platforms, abandoned
 * accounts), and only sets primaryMembershipId under cross save — so picking from it
 * can land on an account GetProfile answers with DestinyAccountNotFound. LinkedProfiles
 * only lists real D2 profiles: take the cross-save primary, else the most recently played
 * one that isn't overridden by cross save.
 */
export async function resolveDestinyAccount(
  http: HttpClient,
  bungieMembershipId: string,
): Promise<DestinyAccount | undefined> {
  const res = await getLinkedProfiles(http, {
    membershipId: bungieMembershipId,
    membershipType: BUNGIE_NEXT,
    getAllMemberships: true,
  });
  const profiles = res.Response?.profiles ?? [];
  const pick =
    profiles.find((p) => p.isCrossSavePrimary) ??
    profiles
      .filter((p) => !p.isOverridden)
      .sort((a, b) => Date.parse(b.dateLastPlayed) - Date.parse(a.dateLastPlayed))[0] ??
    profiles[0];
  if (!pick) return undefined;
  return { membershipId: pick.membershipId, membershipType: pick.membershipType };
}
