import type { QueryClient } from "@tanstack/react-query";
import { clearArmoryCache } from "@/lib/armory/armory-cache";
import { ARMORY_CACHE_KEY, ARMORY_KEY, PROFILE_KEY } from "@/lib/armory/keys";

/**
 * Everything the browser keeps about the signed-in player that must not outlive the
 * session: the persisted armory (IndexedDB) and the in-memory profile/armory queries.
 * Every path that ends a session — the sign-out button, a `reauth` error from the
 * equip/apply routes, a 401 from the profile — goes through here, so write and clear
 * can't drift apart.
 */
export async function forgetLocalSession(queryClient: QueryClient): Promise<void> {
  await clearArmoryCache();
  for (const key of [PROFILE_KEY, ARMORY_KEY, ARMORY_CACHE_KEY]) {
    queryClient.removeQueries({ queryKey: [key] });
  }
}

/** Explicit sign-out: end the server session, then forget the local data. False if the server call failed. */
export async function signOut(queryClient: QueryClient): Promise<boolean> {
  const res = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  if (!res?.ok) return false;
  await forgetLocalSession(queryClient);
  return true;
}

/**
 * The session is already dead server-side (cookies cleared by a route, or a 401):
 * forget the local data and let the session query flip to signed-out so the sign-in
 * card appears.
 */
export async function handleSessionExpired(queryClient: QueryClient): Promise<void> {
  await forgetLocalSession(queryClient);
  await queryClient.invalidateQueries({ queryKey: ["session"] });
}

/**
 * A `reauth` error from a route that may not have been able to clear the cookies
 * itself (the apply stream): end the server session too, then treat it as expired.
 */
export async function signOutForReauth(queryClient: QueryClient): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  await handleSessionExpired(queryClient);
}
