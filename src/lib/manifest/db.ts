import { openDB, type IDBPDatabase } from "idb";
import type { ManifestTableName } from "./tables";

/**
 * IndexedDB cache for the Destiny manifest. Tables are stored under `<stamp>/<table>`
 * keys in the `tables` store and the live stamp (Bungie version + our filter revision)
 * in the `meta` store. A download writes its tables under the NEW stamp while the old
 * ones stay readable, and `commitVersion` then flips the stamp and drops every table
 * that isn't under it — so a download that dies partway (tab closed, worker killed)
 * leaves the previous cache intact and served.
 */

const DB_NAME = "stat-builder-manifest";
const DB_VERSION = 1;
const TABLES_STORE = "tables";
const META_STORE = "meta";
const VERSION_KEY = "version";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(TABLES_STORE);
        db.createObjectStore(META_STORE);
      },
    });
  }
  return dbPromise;
}

const tableKey = (stamp: string, table: ManifestTableName) => `${stamp}/${table}`;

export async function getCachedVersion(): Promise<string | undefined> {
  return (await getDb()).get(META_STORE, VERSION_KEY);
}

export async function getCachedTable<T>(
  stamp: string,
  table: ManifestTableName,
): Promise<Record<number, T> | undefined> {
  return (await getDb()).get(TABLES_STORE, tableKey(stamp, table));
}

export async function setCachedTable<T>(
  stamp: string,
  table: ManifestTableName,
  data: Record<number, T>,
): Promise<void> {
  await (await getDb()).put(TABLES_STORE, data, tableKey(stamp, table));
}

/**
 * Make `stamp` the live cache: write the version and delete every table stored under
 * any other stamp (a previous version, or an abandoned download), in one transaction.
 */
export async function commitVersion(stamp: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([TABLES_STORE, META_STORE], "readwrite");
  const tables = tx.objectStore(TABLES_STORE);
  const prefix = `${stamp}/`;
  for (const key of await tables.getAllKeys()) {
    if (typeof key !== "string" || !key.startsWith(prefix)) await tables.delete(key);
  }
  await tx.objectStore(META_STORE).put(stamp, VERSION_KEY);
  await tx.done;
}
