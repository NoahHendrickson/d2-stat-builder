import {
  getDestinyManifest,
  type DestinyInventoryItemDefinition,
} from "bungie-api-ts/destiny2";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  MANIFEST_TABLES,
  type ManifestTableName,
  type ManifestTables,
} from "./tables";
import {
  clearCache,
  getCachedTable,
  getCachedVersion,
  setCachedTable,
  setCachedVersion,
} from "./db";

const BUNGIE_ROOT = "https://www.bungie.net";

// DestinyItemType values we keep from the (huge) item table.
const ITEM_TYPE_ARMOR = 2;
const ITEM_TYPE_MOD = 19;

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

/** Keep only armor pieces + plugs/mods from the full item table (it's ~190MB otherwise). */
function filterInventoryItems(
  all: Record<number, DestinyInventoryItemDefinition>,
): Record<number, DestinyInventoryItemDefinition> {
  const out: Record<number, DestinyInventoryItemDefinition> = {};
  for (const key in all) {
    const def = all[key];
    if (
      def.itemType === ITEM_TYPE_ARMOR ||
      def.itemType === ITEM_TYPE_MOD ||
      def.plug
    ) {
      out[key as unknown as number] = def;
    }
  }
  return out;
}

async function downloadTable(path: string): Promise<Record<number, unknown>> {
  const res = await fetch(`${BUNGIE_ROOT}${path}`);
  if (!res.ok) throw new Error(`Failed to download ${path}: ${res.status}`);
  return res.json();
}

/**
 * Ensure the manifest is available locally and return typed accessors.
 * Uses the IndexedDB cache when the version matches; otherwise re-downloads
 * the needed tables (filtering the item table down to armor + plugs).
 *
 * `onProgress` also reports how far along the load is as a 0–1 fraction.
 */
export async function loadManifest(
  onProgress?: (message: string, progress: number) => void,
): Promise<Manifest> {
  const http = createBungieHttp();
  onProgress?.("Checking manifest version…", 0);
  const res = await getDestinyManifest(http);
  const info = res.Response;
  const version = info.version;
  const paths = info.jsonWorldComponentContentPaths.en;

  // Cache hit: load every needed table from IndexedDB (in parallel).
  if ((await getCachedVersion()) === version) {
    const tables = {} as ManifestTables;
    const cached = await Promise.all(
      MANIFEST_TABLES.map((table) => getCachedTable(table)),
    );
    if (cached.every((data) => data)) {
      MANIFEST_TABLES.forEach((table, i) => {
        tables[table] = cached[i] as never;
      });
      onProgress?.("Loaded manifest from cache", 1);
      return makeManifest(version, tables);
    }
  }

  // Stale or incomplete: re-download all tables concurrently. The version stamp is
  // written only after every table lands, so a failed download leaves no stamp and the
  // next load re-downloads cleanly.
  await clearCache();
  const tables = {} as ManifestTables;
  let done = 0;
  onProgress?.(`Downloading game data (0/${MANIFEST_TABLES.length})…`, 0);
  await Promise.all(
    MANIFEST_TABLES.map(async (table) => {
      const raw = await downloadTable(paths[table]);
      const data =
        table === "DestinyInventoryItemDefinition"
          ? filterInventoryItems(
              raw as Record<number, DestinyInventoryItemDefinition>,
            )
          : raw;
      tables[table] = data as never;
      await setCachedTable(table, data as Record<number, unknown>);
      done++;
      onProgress?.(
        `Downloading game data (${done}/${MANIFEST_TABLES.length})…`,
        done / MANIFEST_TABLES.length,
      );
    }),
  );
  await setCachedVersion(version);
  onProgress?.("Manifest ready", 1);
  return makeManifest(version, tables);
}
