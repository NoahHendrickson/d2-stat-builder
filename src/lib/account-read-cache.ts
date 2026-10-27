// Account reads (saved loadouts, synced settings) served from Vercel's shared cache
// instead of Neon. Every page load and window focus reads them, and on Neon's plan
// each read keeps the database awake. Every write through this app expires the
// account's entry first, so the next read goes to Neon. An entry is stamped with when
// its read *started*, so a read that overlaps a write can't store the old rows as new.
// Writes that skip this deployment (canary shares the database) show up once the
// entry ages out: after REVALIDATE_SECONDS one stale answer refreshes it, and after
// EXPIRE_SECONDS it is never served. Server-only.
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { getServerLoadoutStore } from "./loadouts/neon-store";
import { getServerSettingsStore } from "./settings/neon-store";

const REVALIDATE_SECONDS = 5 * 60;
const EXPIRE_SECONDS = 10 * 60;

/**
 * Runs a store read, logging its error here: production replaces an error thrown out
 * of a cached function with a generic one, and the real message (a Neon quota 402, say)
 * is what the logs need.
 */
async function logged<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error(`${what} storage error:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

const loadoutsTag = (membershipId: string) => `loadouts:${membershipId}`;
const settingsTag = (membershipId: string) => `settings:${membershipId}`;

/** The account's saved loadouts. Callers check `getServerLoadoutStore()` is set first. */
export async function cachedLoadouts(membershipId: string) {
  "use cache: remote";
  cacheTag(loadoutsTag(membershipId));
  cacheLife({ revalidate: REVALIDATE_SECONDS, expire: EXPIRE_SECONDS });
  return logged("Loadout", () => getServerLoadoutStore()!.list(membershipId));
}

/** The account's synced settings. Callers check `getServerSettingsStore()` is set first. */
export async function cachedSettings(membershipId: string) {
  "use cache: remote";
  cacheTag(settingsTag(membershipId));
  cacheLife({ revalidate: REVALIDATE_SECONDS, expire: EXPIRE_SECONDS });
  return logged("Settings", () => getServerSettingsStore()!.list(membershipId));
}

/** Call after any loadout write, whether or not it succeeded: a failed one may still have landed. */
export function expireLoadouts(membershipId: string) {
  revalidateTag(loadoutsTag(membershipId), { expire: 0 });
}

/** Call after any settings write, whether or not it succeeded. */
export function expireSettings(membershipId: string) {
  revalidateTag(settingsTag(membershipId), { expire: 0 });
}
