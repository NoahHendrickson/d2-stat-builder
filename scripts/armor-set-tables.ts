import { activityLookup, type ActivityLookup, type ActivityTables } from "../src/lib/armory/set-popularity";

/**
 * What the crawl's armor tally reads from the manifest: which bucket each
 * activity counts for (activityLookup), and which set each armor piece is in,
 * from the set definitions (they list their pieces, so the item table, a few
 * hundred MB, isn't needed). About 12 MB of JSON, once per crawl.
 */
export interface ArmorSetTables {
  version: string;
  lookup: ActivityLookup;
  setOf(itemHash: number): number | undefined;
}

interface ManifestResponse {
  ErrorCode: number;
  ErrorStatus: string;
  Response?: { version: string; jsonWorldComponentContentPaths: { en: Record<string, string> } };
}

const TABLES = [
  "DestinyActivityDefinition",
  "DestinyActivityTypeDefinition",
  "DestinyFireteamFinderActivityGraphDefinition",
  "DestinyGlobalConstantsDefinition",
  "DestinyEquipableItemSetDefinition",
] as const;

async function json<T>(url: string, apiKey?: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: apiKey ? { "X-API-Key": apiKey } : {},
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return (await response.json()) as T;
      if (attempt >= 3 || response.status < 500) throw new Error(`${url} answered ${response.status}.`);
    } catch (error) {
      if (attempt >= 3) throw error;
    }
    await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt));
  }
}

export async function loadArmorSetTables(apiKey: string): Promise<ArmorSetTables> {
  const manifest = await json<ManifestResponse>("https://www.bungie.net/Platform/Destiny2/Manifest/", apiKey);
  if (manifest.ErrorCode !== 1 || !manifest.Response) throw new Error(`Couldn't read the manifest (${manifest.ErrorStatus}).`);
  const paths = manifest.Response.jsonWorldComponentContentPaths.en;
  const [activities, activityTypes, fireteamFinderGraph, constants, sets] = await Promise.all(
    TABLES.map((table) => {
      if (!paths[table]) throw new Error(`The manifest has no ${table}.`);
      return json<Record<string, never>>(`https://www.bungie.net${paths[table]}`);
    }),
  );
  const global = Object.values(constants as Record<string, { vanguardAlertsFireteamFinderActivityGraphRootNodeHash?: number }>)[0];
  const tables: ActivityTables = {
    activities,
    activityTypes,
    fireteamFinderGraph,
    vanguardAlertsRoot: global?.vanguardAlertsFireteamFinderActivityGraphRootNodeHash,
  };
  if (tables.vanguardAlertsRoot === undefined) console.warn("The manifest names no Vanguard Alerts root; GM alerts won't be counted.");
  const setOfItem = new Map<number, number>();
  for (const [hash, set] of Object.entries(sets as Record<string, { setItems?: number[]; setPerks?: unknown[] }>)) {
    if (!set.setPerks?.length) continue;
    for (const item of set.setItems ?? []) setOfItem.set(item, Number(hash));
  }
  return { version: manifest.Response.version, lookup: activityLookup(tables), setOf: (item) => setOfItem.get(item) };
}
