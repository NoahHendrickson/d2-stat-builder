import {
  getDestinyManifest,
  type DestinyInventoryItemDefinition,
  type DestinyManifest,
  type DestinyMaterialRequirementSetDefinition,
} from "bungie-api-ts/destiny2";
import { isFestivalMask } from "@/lib/armory/festival-masks";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  MANIFEST_TABLES,
  type ManifestTableName,
  type ManifestTables,
} from "./tables";
import { projectItemDef, type ItemDef } from "./item-def";
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
const ITEM_TYPE_SUBCLASS = 16;
// Bump when the item-table filter changes so IndexedDB isn't stuck without new defs.
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

/**
 * Every item any material requirement set charges (Glimmer, Enhancement Cores, …).
 * Materials are itemType None/Currency, so they need keeping by hash to survive the
 * item-table filter and give masterwork costs their names and icons.
 */
function materialItemHashes(
  sets: Record<number, DestinyMaterialRequirementSetDefinition>,
): Set<number> {
  const out = new Set<number>();
  for (const key in sets) {
    for (const m of sets[key].materials ?? []) out.add(m.itemHash);
  }
  return out;
}

/**
 * Keep armor, subclasses, plugs/mods, Festival of the Lost masks, and upgrade materials,
 * projected down to the fields the app reads (`ItemDef`).
 */
export function filterInventoryItems(
  all: Record<number, DestinyInventoryItemDefinition>,
  materials: Set<number>,
): Record<number, ItemDef> {
  const out: Record<number, ItemDef> = {};
  for (const key in all) {
    const def = all[key];
    // FotL masks use the helmet bucket but are not itemType Armor — without this
    // they vanish from the cached item table and never enter the armory.
    if (
      def.itemType === ITEM_TYPE_ARMOR ||
      materials.has(Number(key)) ||
      def.itemType === ITEM_TYPE_MOD ||
      def.itemType === ITEM_TYPE_SUBCLASS ||
      def.plug ||
      isFestivalMask(Number(key), def)
    ) {
      out[key as unknown as number] = projectItemDef(def);
    }
  }
  return out;
}

async function downloadTable(path: string): Promise<Record<number, unknown>> {
  const res = await fetch(`${BUNGIE_ROOT}${path}`);
  if (!res.ok) throw new Error(`Failed to download ${path}: ${res.status}`);
  return res.json();
}

type ProgressFn = (message: string, progress: number) => void;

export interface LoadManifestOptions {
  /** Load-stage messages and a 0–1 fraction, for the loading screen. */
  onProgress?: ProgressFn;
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

/**
 * Download every table concurrently (filtering + projecting the item table) and cache
 * them. The version stamp is written only after every table lands, so a failed download
 * leaves no stamp and the next load re-downloads cleanly.
 */
async function downloadAll(
  info: DestinyManifest,
  onProgress?: ProgressFn,
): Promise<Manifest> {
  const paths = info.jsonWorldComponentContentPaths.en;
  await clearCache();
  const tables = {} as ManifestTables;
  let done = 0;
  onProgress?.(`Downloading game data (0/${MANIFEST_TABLES.length})…`, 0);
  // The item filter needs the (tiny) material table to know which currencies to keep.
  const materialSets = downloadTable(
    paths.DestinyMaterialRequirementSetDefinition,
  ) as Promise<Record<number, DestinyMaterialRequirementSetDefinition>>;
  await Promise.all(
    MANIFEST_TABLES.map(async (table) => {
      const raw =
        table === "DestinyMaterialRequirementSetDefinition"
          ? await materialSets
          : await downloadTable(paths[table]);
      const data =
        table === "DestinyInventoryItemDefinition"
          ? filterInventoryItems(
              raw as Record<number, DestinyInventoryItemDefinition>,
              materialItemHashes(await materialSets),
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
