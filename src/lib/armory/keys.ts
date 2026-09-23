/** React Query keys for the signed-in player's data (one place, so the sign-out path can drop them all). */

export const PROFILE_KEY = "profile";
export const ARMORY_KEY = "armory";
export const ARMORY_CACHE_KEY = "armory-cache";

export const profileKey = (membershipId: string | undefined) =>
  [PROFILE_KEY, membershipId] as const;

/** A derived armory: this account, this manifest, this profile fetch. */
export const armoryKey = (
  membershipId: string | undefined,
  manifestVersion: string | undefined,
  profileUpdatedAt: number,
) => [ARMORY_KEY, membershipId, manifestVersion, profileUpdatedAt] as const;

export const armoryCacheKey = (membershipId: string | undefined) =>
  [ARMORY_CACHE_KEY, membershipId] as const;
