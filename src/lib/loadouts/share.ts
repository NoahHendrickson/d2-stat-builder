// Share links. Sharing stores a snapshot of the loadout server-side under a short code
// (see share-store.ts) and copies `/loadouts#s=<code>`. The code rides in the fragment
// so it stays out of request logs and analytics, the same as the older self-contained
// links, which carry the whole loadout as JSON in `#import=` (or `?import=` before
// that). Those were thousands of characters long; they still open, and the client
// falls back to one if the short link can't be stored.
// Runtime imports are relative for vitest.
import {
  LOADOUT_SCHEMA_VERSION,
  parseSavedLoadoutData,
  type SavedLoadoutData,
} from "./types";

export const SHARE_PARAM = "import";
export const SHARE_CODE_PARAM = "s";

/** Short codes: 10 base62 characters (~59 bits), so they can't be guessed. */
export const SHARE_CODE_LENGTH = 10;
const SHARE_CODE = new RegExp(`^[0-9A-Za-z]{${SHARE_CODE_LENGTH}}$`);
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

/** The raw `import` value in a URL fragment (`#import=…`), or null. */
export function shareParamFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get(SHARE_PARAM);
}

/** A well-formed short code in a URL fragment (`#s=…`), or null. */
export function shareCodeFromHash(hash: string): string | null {
  const code = new URLSearchParams(hash.replace(/^#/, "")).get(SHARE_CODE_PARAM);
  return isShareCode(code) ? code : null;
}

/** The loadout carried by a share link's `import` param, or null if absent/invalid. */
export function parseShareParam(value: string | null): SavedLoadoutData | null {
  if (!value) return null;
  try {
    return parseSavedLoadoutData(JSON.parse(value));
  } catch {
    return null;
  }
}
