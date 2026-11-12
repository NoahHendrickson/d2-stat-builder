// Manifest tables only one server route reads (the in-game loadout identifiers, the
// pattern records) are fetched by that route on demand instead of joining the client
// manifest: adding a table there re-downloads the whole manifest for everyone.
import {
  getDestinyManifest,
  type AllDestinyManifestComponents,
} from "bungie-api-ts/destiny2";
import { BUNGIE_IMAGE_BASE } from "./constants";
import { createBungieHttp } from "./http";

type TableName = keyof AllDestinyManifestComponents;
type Paths = Partial<Record<TableName, string>>;

/** Every definition in one table, from its path in the manifest info. */
export async function fetchManifestTable<K extends TableName>(
  paths: Paths,
  table: K,
  init?: RequestInit,
): Promise<AllDestinyManifestComponents[K][number][]> {
  const path = paths[table];
  if (!path) throw new Error(`Bungie's manifest is missing ${table}`);
  const res = await fetch(`${BUNGIE_IMAGE_BASE}${path}`, init);
  if (!res.ok) throw new Error(`Bungie manifest table request failed (HTTP ${res.status})`);
  return Object.values((await res.json()) as AllDestinyManifestComponents[K]);
}

/** How long a built value is served before checking whether Bungie shipped a new manifest. */
const CHECK_EVERY_MS = 60 * 60_000;

/**
 * `build`'s result, kept per server instance for the manifest version it was built from:
 * once an hour the (small) manifest info is fetched again, and `build` reruns only when
 * the version changed. Concurrent callers share one build, and a failed one isn't kept.
 */
export function perManifestVersion<T>(build: (paths: Paths) => Promise<T>): () => Promise<T> {
  let cached: { version: string; checkedAt: number; value: Promise<T> } | undefined;
  let pending: Promise<T> | undefined;

  const refresh = async (): Promise<T> => {
    const info = (await getDestinyManifest(createBungieHttp())).Response;
    if (cached?.version === info.version) {
      cached.checkedAt = Date.now();
      return cached.value;
    }
    const value = build(info.jsonWorldComponentContentPaths.en as Paths);
    await value;
    cached = { version: info.version, checkedAt: Date.now(), value };
    return value;
  };

  return () => {
    if (cached && Date.now() - cached.checkedAt < CHECK_EVERY_MS) return cached.value;
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
