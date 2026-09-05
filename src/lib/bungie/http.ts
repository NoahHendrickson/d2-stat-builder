import type { HttpClient, HttpClientConfig } from "bungie-api-ts/http";
import { BUNGIE_API_KEY } from "./constants";

/** PlatformErrorCodes.Success */
const BUNGIE_SUCCESS = 1;

interface BungieErrorBody {
  ErrorCode?: number;
  ErrorStatus?: string;
  Message?: string;
}

/** A failed Bungie API response, carrying the HTTP status so callers can categorize it. */
export class BungieHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Bungie PlatformErrorCodes value from the body, when present. */
    public readonly code?: number,
  ) {
    super(message);
    this.name = "BungieHttpError";
  }
}

/**
 * Builds an HttpClient compatible with `bungie-api-ts` request functions.
 * Adds the API key (and a Bearer token when authenticated), surfaces Bungie's
 * real error status, and retries once on a transient 5xx.
 *
 * Authenticated calls should run server-side (Node sends no Origin header, so
 * Bungie's OriginHeaderDoesNotMatchKey check never fires).
 */
export function createBungieHttp(accessToken?: string): HttpClient {
  // Fail fast with a clear message — every Bungie call flows through here, and without
  // the key Bungie returns opaque errors. (A module-level throw in constants.ts would
  // break `next build` when the env is absent.)
  if (!BUNGIE_API_KEY) {
    throw new Error("NEXT_PUBLIC_BUNGIE_API_KEY is not set — see .env.example");
  }
  const http = async (config: HttpClientConfig) => {
    const url = new URL(config.url);
    if (config.params) {
      for (const [key, value] of Object.entries(config.params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = { "X-API-Key": BUNGIE_API_KEY };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (config.body) headers["Content-Type"] = "application/json";

    const init: RequestInit = {
      method: config.method,
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url.toString(), init);
      const text = await res.text();
      let json: (BungieErrorBody & Record<string, unknown>) | undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }

      // Bungie reports platform errors in the body (ErrorCode ≠ 1 = Success), sometimes
      // under an HTTP 200 — so a 2xx alone doesn't mean the action happened.
      const bodyFailed = json?.ErrorCode !== undefined && json.ErrorCode !== BUNGIE_SUCCESS;
      if (res.ok && !bodyFailed) return json;

      const detail = json?.ErrorStatus
        ? `${json.ErrorStatus}${json.Message ? ` — ${json.Message}` : ""}`
        : `HTTP ${res.status}`;
      lastError = new BungieHttpError(
        res.status,
        `Bungie ${config.method} ${url.pathname}: ${detail}`,
        json?.ErrorCode,
      );
      if (res.status < 500) break; // 4xx (and in-body errors on a 200) won't fix themselves
      await new Promise((r) => setTimeout(r, 600));
    }
    throw lastError ?? new Error("Bungie request failed");
  };

  return http as unknown as HttpClient;
}
