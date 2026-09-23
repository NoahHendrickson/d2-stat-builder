import { openDB, type IDBPDatabase } from "idb";
import type { Armory } from "./fetch";

/**
 * The last normalized armory per account, so a returning player sees their gear the
 * moment the manifest is ready instead of after the profile round trip. It is only a
 * placeholder: the live profile is always fetched and replaces it.
 */

const DB_NAME = "stat-builder-armory";
const DB_VERSION = 1;
const STORE = "armory";

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

export async function readArmoryCache(
  membershipId: string,
): Promise<ArmoryCacheEntry | null> {
  try {
    return ((await (await getDb()).get(STORE, membershipId)) as ArmoryCacheEntry | undefined) ?? null;
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

export async function clearArmoryCache(): Promise<void> {
  try {
    await (await getDb()).clear(STORE);
  } catch {
    // Nothing to clear (or no IndexedDB).
  }
}
