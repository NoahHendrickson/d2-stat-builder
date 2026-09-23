import { openDB, type IDBPDatabase } from "idb";
import type { Armory } from "./fetch";

/**
 * The last normalized armory per account, so a returning player sees their gear the
 * moment the manifest is ready instead of after the profile round trip. It is only a
 * placeholder: the live profile is always fetched and replaces it. Entries older than
 * the TTL are ignored, and a session ending clears the store (auth/sign-out.ts) —
 * including any write still queued at that moment (see `persistArmoryWhenIdle`).
 */

const DB_NAME = "stat-builder-armory";
const DB_VERSION = 1;
const STORE = "armory";
/** How long a cached armory stays usable as a placeholder. */
export const ARMORY_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

export interface ArmoryCacheEntry {
  /** The manifest the armory was normalized against; a different one is not reused. */
  manifestVersion: string;
  savedAt: number;
  armory: Armory;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/** The account's cached armory, or null if there is none or it is older than the TTL. */
export async function readArmoryCache(
  membershipId: string,
  now: number = Date.now(),
): Promise<ArmoryCacheEntry | null> {
  try {
    const entry = (await (await getDb()).get(STORE, membershipId)) as ArmoryCacheEntry | undefined;
    if (!entry || now - entry.savedAt > ARMORY_CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function writeArmoryCache(
  membershipId: string,
  entry: ArmoryCacheEntry,
): Promise<void> {
  try {
    await (await getDb()).put(STORE, entry, membershipId);
  } catch (err) {
    console.warn("Could not cache the armory", err);
  }
}

// Bumped by every clear. A deferred write captured under an older generation is
// dropped, so a write queued just before sign-out can't repopulate the store after it.
let generation = 0;

/** Run `fn` when the browser is idle. */
const whenIdle = (fn: () => void): void => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 5000 });
  else setTimeout(fn, 1000);
};

/**
 * Persist `entry` in idle time (the write is a structured clone of the whole armory,
 * so it must not land in the middle of the first render) — unless the store was
 * cleared in the meantime, in which case the session ended and the write is dropped.
 */
export function persistArmoryWhenIdle(membershipId: string, entry: ArmoryCacheEntry): void {
  const queuedIn = generation;
  whenIdle(() => {
    if (generation !== queuedIn) return;
    void writeArmoryCache(membershipId, entry);
  });
}

export async function clearArmoryCache(): Promise<void> {
  generation++;
  try {
    await (await getDb()).clear(STORE);
  } catch {
    // Nothing to clear (or no IndexedDB).
  }
}
