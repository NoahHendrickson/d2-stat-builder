import { getDestinyManifest, type DestinyManifest } from "bungie-api-ts/destiny2";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  MANIFEST_TABLES,
  type ManifestTableName,
  type ManifestTables,
} from "./tables";
import { getCachedTable, getCachedVersion, setCachedVersion } from "./db";
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
}

/** Cache stamp: Bungie's version plus our filter revision, so either change invalidates. */
const stampFor = (version: string) => `${version}:${CACHE_REVISION}`;
const versionOf = (stamp: string) => stamp.slice(0, stamp.lastIndexOf(":"));

/** Every table from IndexedDB, if the cache is complete and from this filter revision. */
async function readCache(): Promise<
  { stamp: string; tables: ManifestTables } | undefined
> {
  const [stamp, ...cached] = await Promise.all([
    getCachedVersion(),
    ...MANIFEST_TABLES.map((table) => getCachedTable(table)),
  ]);
  if (!stamp || !stamp.endsWith(`:${CACHE_REVISION}`)) return undefined;
  if (!cached.every((data) => data)) return undefined;
  const tables = {} as ManifestTables;
  MANIFEST_TABLES.forEach((table, i) => {
    tables[table] = cached[i] as never;
  });
  return { stamp, tables };
}

/** Run `downloadTables` in a dedicated worker, relaying its progress. */
function downloadTablesInWorker(
  paths: TablePaths,
  onProgress?: DownloadProgress,
): Promise<ManifestTables> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./download-worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (settle: () => void) => {
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
    worker.postMessage({ paths } satisfies DownloadRequest);
  });
}

/**
 * Download every table (in a worker when available — the item table alone is 200 MB
 * of JSON to parse) and cache them. The version stamp is written only after every
 * table lands, so a failed download leaves no stamp and the next load re-downloads
 * cleanly.
 */
async function downloadAll(
  info: DestinyManifest,
  onProgress?: DownloadProgress,
): Promise<Manifest> {
  const paths = info.jsonWorldComponentContentPaths.en as TablePaths;
  const tables =
    typeof Worker === "undefined"
      ? await downloadTables(paths, onProgress)
      : await downloadTablesInWorker(paths, onProgress);
  await setCachedVersion(stampFor(info.version));
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
        if (stampFor(info.version) === cached.stamp) return;
        onUpdate?.(await downloadAll(info));
      })
      .catch((err: unknown) => {
        console.warn("Manifest revalidation failed; keeping the cached version", err);
      });
    return makeManifest(versionOf(cached.stamp), cached.tables);
  }

  return downloadAll(await infoPromise, onProgress);
}
