import type {
  DestinyInventoryItemDefinition,
  DestinyMaterialRequirementSetDefinition,
} from "bungie-api-ts/destiny2";
import { isFestivalMask } from "@/lib/armory/festival-masks";
import { clearCache, setCachedTable } from "./db";
import { projectItemDef, type ItemDef } from "./item-def";
import { MANIFEST_TABLES, type ManifestTableName, type ManifestTables } from "./tables";

/**
 * Downloading the manifest tables: fetch, filter + project the (200 MB) item table, and
 * write each table to IndexedDB. Runs in a Web Worker on first visit (see
 * download-worker.ts) and inline where workers are unavailable — this module must stay
 * free of DOM and React imports.
 */

const BUNGIE_ROOT = "https://www.bungie.net";

// DestinyItemType values we keep from the (huge) item table.
const ITEM_TYPE_ARMOR = 2;
const ITEM_TYPE_MOD = 19;
const ITEM_TYPE_SUBCLASS = 16;

/** `jsonWorldComponentContentPaths.en` from the manifest info: table name → path. */
export type TablePaths = Record<ManifestTableName, string>;

export type DownloadProgress = (message: string, progress: number) => void;

/** Worker protocol. */
export type DownloadRequest = { paths: TablePaths };
export type DownloadResponse =
  | { kind: "progress"; message: string; progress: number }
  | { kind: "done"; tables: ManifestTables }
  | { kind: "error"; message: string };

/**
 * Every item any material requirement set charges (Glimmer, Enhancement Cores, …).
 * Materials are itemType None/Currency, so they need keeping by hash to survive the
 * item-table filter and give masterwork costs their names and icons.
 */
export function materialItemHashes(
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

/**
 * Download every table concurrently and cache each as it lands. The cache is cleared
 * first and the caller writes the version stamp afterwards, so a failed download
 * leaves no stamp and the next load re-downloads cleanly.
 */
export async function downloadTables(
  paths: TablePaths,
  onProgress?: DownloadProgress,
): Promise<ManifestTables> {
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
  return tables;
}
