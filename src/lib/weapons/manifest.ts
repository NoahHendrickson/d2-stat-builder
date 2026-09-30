import type { HttpClient } from "bungie-api-ts/http";
import {
  getDestinyManifest,
  getDestinyManifestSlice,
  type DestinyManifestSlice,
} from "bungie-api-ts/destiny2";

/** The manifest tables we need to flatten weapons + perk pools + stats. */
export const MANIFEST_SLICES = [
  "DestinyInventoryItemDefinition",
  "DestinyPlugSetDefinition",
  "DestinyStatDefinition",
  "DestinyStatGroupDefinition",
  "DestinyDamageTypeDefinition",
  "DestinySeasonDefinition",
  "DestinyCollectibleDefinition",
  "DestinyPresentationNodeDefinition",
  "DestinyVendorDefinition",
  "DestinySandboxPerkDefinition",
] as const;

export type ManifestDefs = DestinyManifestSlice<typeof MANIFEST_SLICES>;

/** HTTP statuses worth retrying during manifest generation (transient Bungie/CDN failures). */
export function isRetryableBungieHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

const DEFAULT_BUNGIE_FETCH_ATTEMPTS = 4;
const DEFAULT_BUNGIE_FETCH_BASE_DELAY_MS = 1000;

function bungieFetchDelayMs(attempt: number): number {
  return DEFAULT_BUNGIE_FETCH_BASE_DELAY_MS * 2 ** (attempt - 1);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchBungieWithRetry(
  url: string | URL,
  init: RequestInit,
  label: string,
  maxAttempts = DEFAULT_BUNGIE_FETCH_ATTEMPTS,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;

      lastError = new Error(`Bungie API ${label} → ${res.status} ${res.statusText}`);
      if (!isRetryableBungieHttpStatus(res.status) || attempt === maxAttempts) {
        throw lastError;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const statusMatch = /→ (\d{3}) /.exec(lastError.message);
      const retryableHttp =
        statusMatch != null && isRetryableBungieHttpStatus(Number(statusMatch[1]));
      const retryableNetwork = statusMatch == null;

      if (attempt === maxAttempts || (!retryableHttp && !retryableNetwork)) {
        throw lastError;
      }
    }

    const delayMs = bungieFetchDelayMs(attempt);
    console.warn(`${lastError.message}; retrying in ${delayMs}ms (${attempt}/${maxAttempts})…`);
    await sleep(delayMs);
  }

  throw lastError ?? new Error(`Bungie API ${label} failed`);
}

/**
 * A minimal Bungie HTTP client. bungie-api-ts builds absolute URLs, so we just
 * attach the API key header and parse JSON.
 */
export function createHttpClient(apiKey: string): HttpClient {
  const client: HttpClient = async (config) => {
    const url = new URL(config.url);
    if (config.params) {
      for (const [key, value] of Object.entries(config.params)) {
        url.searchParams.set(key, value);
      }
    }
    const res = await fetchBungieWithRetry(
      url,
      {
        method: config.method,
        headers: { "X-API-Key": apiKey },
        body: config.body != null ? JSON.stringify(config.body) : undefined,
      },
      `${config.method} ${config.url}`,
    );
    const data: unknown = await res.json();
    return data as never;
  };
  return client;
}

/** Download the manifest version + the definition tables we need. */
export async function downloadManifest(
  apiKey: string,
): Promise<{ version: string; defs: ManifestDefs }> {
  const http = createHttpClient(apiKey);
  const manifest = await getDestinyManifest(http);
  const defs = await getDestinyManifestSlice(http, {
    destinyManifest: manifest.Response,
    tableNames: [...MANIFEST_SLICES],
    language: "en",
  });
  return { version: manifest.Response.version, defs };
}

/** Mobile-manifest icon entry (DestinyIconDefinition). */
export interface DestinyIconDefinitionEntry {
  hash: number;
  foreground?: string;
  redacted?: boolean;
}

/** Download DestinyIconDefinition — used for HUD ammo-type icons. */
export async function downloadDestinyIconDefinitions(
  apiKey: string,
): Promise<Record<string, DestinyIconDefinitionEntry>> {
  const http = createHttpClient(apiKey);
  const manifest = await getDestinyManifest(http);
  const path =
    manifest.Response.jsonWorldComponentContentPaths.en?.DestinyIconDefinition;
  if (!path) {
    throw new Error("DestinyIconDefinition missing from manifest paths");
  }
  const res = await fetchBungieWithRetry(
    `https://www.bungie.net${path}`,
    { headers: { "X-API-Key": apiKey } },
    "GET DestinyIconDefinition",
  );
  return (await res.json()) as Record<string, DestinyIconDefinitionEntry>;
}
