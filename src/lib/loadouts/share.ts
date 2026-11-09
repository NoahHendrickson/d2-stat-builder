// Share links. Sharing stores a snapshot of the loadout server-side under a short code
// (see share-store.ts) and copies `/loadouts#s=<code>`. The code rides in the fragment
// so it stays out of request logs and analytics, the same as the older self-contained
// links, which carry the whole loadout as JSON in `#import=` (or `?import=` before
// that). Those were thousands of characters long; they still open, and the client
// falls back to one if the short link can't be stored.
// Runtime imports are relative for vitest.
import {
  LOADOUT_SCHEMA_VERSION,
  asPlayerLoadout,
  parseSavedLoadoutData,
  type SavedLoadoutData,
} from "./types";

export const SHARE_PARAM = "import";
export const SHARE_CODE_PARAM = "s";

/** Short codes: 10 base62 characters (~59 bits), so they can't be guessed. */
export const SHARE_CODE_LENGTH = 10;
const SHARE_CODE = new RegExp(`^[0-9A-Za-z]{${SHARE_CODE_LENGTH}}$`);
const SHARE_CODE_PREFIX = new RegExp(`^[0-9A-Za-z]{${SHARE_CODE_LENGTH}}`);
export const isShareCode = (v: unknown): v is string => typeof v === "string" && SHARE_CODE.test(v);

/**
 * Strip owner-only fields so a link carries just the loadout definition. Mod placement
 * is keyed by the owner's item instance ids, so it means nothing to anyone else.
 */
export function shareableData(saved: SavedLoadoutData): SavedLoadoutData {
  const data: SavedLoadoutData = { version: LOADOUT_SCHEMA_VERSION, loadout: saved.loadout };
  if (saved.optimizer) data.optimizer = saved.optimizer;
  if (saved.builder) data.builder = saved.builder;
  return data;
}

/** The short link for a stored share. */
export function shortShareUrl(origin: string, code: string): string {
  const url = new URL("/loadouts", origin);
  url.hash = new URLSearchParams({ [SHARE_CODE_PARAM]: code }).toString();
  return url.toString();
}

/** The self-contained link: the whole loadout as JSON in the fragment. */
export function buildShareUrl(origin: string, saved: SavedLoadoutData): string {
  const url = new URL("/loadouts", origin);
  url.hash = new URLSearchParams({ [SHARE_PARAM]: JSON.stringify(shareableData(saved)) }).toString();
  return url.toString();
}

/** A share link found in a URL. `key` tells one link from another (to dismiss it once). */
export type ShareSource =
  | { kind: "code"; key: string; code: string }
  | { kind: "inline"; key: string; data: SavedLoadoutData };

/**
 * The share link in a URL, or null when there is none or an inline one doesn't parse.
 * A short `#s=<code>` wins, then the self-contained `#import=<json>`, then the oldest
 * `?import=<json>`.
 */
export function shareSourceFrom(
  hash: string,
  search: Pick<URLSearchParams, "get">,
): ShareSource | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const raw = fragment.get(SHARE_CODE_PARAM);
  if (raw !== null) {
    // Chat apps and sentences tack punctuation onto links, so read the code's length
    // and drop the rest. A code cut short is still looked up, so the reader hears that
    // the link doesn't work instead of nothing happening.
    const code = SHARE_CODE_PREFIX.exec(raw)?.[0] ?? raw;
    return { kind: "code", key: `${SHARE_CODE_PARAM}=${code}`, code };
  }
  const json = fragment.get(SHARE_PARAM) ?? search.get(SHARE_PARAM);
  if (!json) return null;
  try {
    const data = asPlayerLoadout(parseSavedLoadoutData(JSON.parse(json)));
    return data && { kind: "inline", key: `${SHARE_PARAM}=${json}`, data };
  } catch {
    return null;
  }
}
