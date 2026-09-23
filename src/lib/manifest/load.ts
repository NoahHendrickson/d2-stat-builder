import { getDestinyManifest, type DestinyManifest } from "bungie-api-ts/destiny2";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  MANIFEST_TABLES,
  type ManifestTableName,
  type ManifestTables,
} from "./tables";
import { commitVersion, getCachedTable, getCachedVersion } from "./db";
import {
  downloadTables,
  type DownloadProgress,
  type DownloadRequest,
  type DownloadResponse,
  type TablePaths,
} from "./download";

// Bump when the item-table filter or projection changes so IndexedDB isn't stuck
// without new defs.
const CACHE_REVISION = "item-def-projection-v1";

export interface Manifest {
  version: string;
  tables: ManifestTables;
  /** Look up a single definition by hash. */
  def<T extends ManifestTableName>(
    table: T,
    hash: number | undefined | null,
  ): ManifestTables[T][number] | undefined;
  /** The whole table. */
  all<T extends ManifestTableName>(table: T): ManifestTables[T];
  /** Entry counts per table (for diagnostics). */
  counts(): Record<ManifestTableName, number>;
}

function makeManifest(version: string, tables: ManifestTables): Manifest {
  return {
    version,
    tables,
    def(table, hash) {
      if (hash == null) return undefined;
      return tables[table][hash];
    },
    all(table) {
      return tables[table];
    },
    counts() {
      const out = {} as Record<ManifestTableName, number>;
      for (const t of MANIFEST_TABLES) out[t] = Object.keys(tables[t]).length;
      return out;
    },
  };
}

export interface LoadManifestOptions {
  /** Load-stage messages and a 0–1 fraction, for the loading screen. */
  onProgress?: DownloadProgress;
  /**
   * A cached manifest is returned immediately and revalidated in the background; when
   * Bungie has published a newer version, it is downloaded, cached, and handed here.
   */
  onUpdate?: (manifest: Manifest) => void;
  /**
   * The cached manifest served is older than Bungie's current one and the newer one is
   * on its way (true), or that finished / failed (false). While true, gear released
   * with the new version can't be resolved yet.
   */
  onUpdating?: (updating: boolean) => void;
}

/** Cache stamp: Bungie's version plus our filter revision, so either change invalidates. */
const REVISION_SUFFIX = `:${CACHE_REVISION}`;
const stampFor = (version: string) => `${version}${REVISION_SUFFIX}`;
/** The Bungie version inside a stamp of THIS revision, else undefined (exact split). */
const versionOf = (stamp: string): string | undefined =>
  stamp.endsWith(REVISION_SUFFIX) && stamp.length > REVISION_SUFFIX.length
    ? stamp.slice(0, -REVISION_SUFFIX.length)
    : undefined;

/**
 * Every table from IndexedDB, if the cache is complete and from this filter revision.
 * The stamp is checked BEFORE any table is read: on a revision bump the old tables are
 * useless, and deserializing them (the biggest cost on this path) just to discard them
 * would stall the main thread for nothing.
 */
async function readCache(): Promise<
  { stamp: string; tables: ManifestTables } | undefined
> {
  const stamp = await getCachedVersion();
  if (!stamp || versionOf(stamp) === undefined) return undefined;
  const cached = await Promise.all(
    MANIFEST_TABLES.map((table) => getCachedTable(stamp, table)),
  );
  if (!cached.every((data) => data)) return undefined;
  const tables = {} as ManifestTables;
  MANIFEST_TABLES.forEach((table, i) => {
    tables[table] = cached[i] as never;
  });
  return { stamp, tables };
}

/**
 * Outer limit on the worker download. A worker killed under memory pressure does not
 * reliably fire `onerror`; without this the promise (and the loading screen) would hang
 * forever. Generous: a 10.7 MB gz download + 200 MB parse on a slow phone takes minutes.
 */
const WORKER_TIMEOUT_MS = 10 * 60_000;

/** Run `downloadTables` in a dedicated worker, relaying its progress. */
function downloadTablesInWorker(
  stamp: string,
  paths: TablePaths,
  onProgress?: DownloadProgress,
): Promise<ManifestTables> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./download-worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(
      () => finish(() => reject(new Error("Manifest download timed out"))),
      WORKER_TIMEOUT_MS,
    );
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    worker.onmessage = (e: MessageEvent<DownloadResponse>) => {
      const msg = e.data;
      if (msg.kind === "progress") onProgress?.(msg.message, msg.progress);
      else if (msg.kind === "done") finish(() => resolve(msg.tables));
      else finish(() => reject(new Error(msg.message)));
    };
    worker.onerror = (e) =>
      finish(() => reject(new Error(e.message || "Manifest download worker failed")));
    worker.onmessageerror = () =>
      finish(() => reject(new Error("Manifest download worker sent an unreadable message")));
    worker.postMessage({ stamp, paths } satisfies DownloadRequest);
  });
}

/**
 * Download every table (in a worker when available — the item table alone is 200 MB
 * of JSON to parse) under the new stamp, then commit: the stamp flips and older
 * tables are dropped only after every table has landed, so a failed download leaves
 * the previous cache intact (db.ts).
 */
async function downloadAll(
  info: DestinyManifest,
  onProgress?: DownloadProgress,
): Promise<Manifest> {
  const paths = info.jsonWorldComponentContentPaths.en as TablePaths;
  const stamp = stampFor(info.version);
  const tables =
    typeof Worker === "undefined"
      ? await downloadTables(stamp, paths, onProgress)
      : await downloadTablesInWorker(stamp, paths, onProgress);
  await commitVersion(stamp);
  onProgress?.("Manifest ready", 1);
  return makeManifest(info.version, tables);
}

/**
 * Ensure the manifest is available locally and return typed accessors.
 *
 * Stale-while-revalidate: the IndexedDB cache and Bungie's version check start
 * together. A complete cache is returned as soon as it is read — the version round
 * trip (and Bungie being down) never delays a warm load — and if the version has
 * moved on, the new tables are downloaded in the background and delivered via
 * `onUpdate`. Without a usable cache, the tables are downloaded before returning.
 */
export async function loadManifest({
  onProgress,
  onUpdate,
  onUpdating,
}: LoadManifestOptions = {}): Promise<Manifest> {
  const http = createBungieHttp();
  onProgress?.("Loading game data…", 0);
  const infoPromise = getDestinyManifest(http).then((res) => res.Response);
  // Never let the (unawaited) version check reject unhandled on the cached path.
  infoPromise.catch(() => {});

  const cached = await readCache();
  if (cached) {
    onProgress?.("Loaded game data from cache", 1);
    void infoPromise
      .then(async (info) => {
        const target = stampFor(info.version);
        if (target === cached.stamp) return;
        onUpdating?.(true);
        try {
          // One tab at a time: two tabs revalidating together would interleave their
          // table writes under the same stamp. A tab that can't get the lock waits for
          // the holder and then reads what it committed, so it gets the update too.
          const manifest = await withRevalidationLock(
            () => downloadAll(info),
            async () => {
              const fresh = await readCache();
              return fresh?.stamp === target
                ? makeManifest(info.version, fresh.tables)
                : undefined;
            },
          );
          if (manifest) onUpdate?.(manifest);
        } finally {
          onUpdating?.(false);
        }
      })
      .catch((err: unknown) => {
        console.warn("Manifest revalidation failed; keeping the cached version", err);
      });
    return makeManifest(versionOf(cached.stamp) as string, cached.tables);
  }

  return downloadAll(await infoPromise, onProgress);
}

/**
 * Run `fn` under the cross-tab revalidation lock. If another tab holds it, wait for
 * that tab to finish and run `afterHolder` instead (it reads the holder's commit).
 */
async function withRevalidationLock<T>(
  fn: () => Promise<T>,
  afterHolder: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  const NAME = "manifest-revalidate";
  const ran = await locks.request(NAME, { ifAvailable: true }, async (lock) =>
    lock ? { value: await fn() } : undefined,
  );
  if (ran) return ran.value;
  // Held elsewhere: a plain request resolves once the holder releases.
  await locks.request(NAME, () => Promise.resolve());
  return afterHolder();
}
