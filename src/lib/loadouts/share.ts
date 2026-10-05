// Self-contained share links: the loadout travels inside the URL (same idea as DIM's
// `/loadouts?loadout=` handoff), so sharing needs no backend row and a recipient who
// isn't the owner still gets a full copy. It rides in the fragment (`#import=`), which
// browsers never send to a server, so notes and item ids stay out of request logs and
// analytics. Links from before that used `?import=` and still open.
// Runtime imports are relative for vitest.
import {
  LOADOUT_SCHEMA_VERSION,
  parseSavedLoadoutData,
  type SavedLoadout,
  type SavedLoadoutData,
} from "./types";

export const SHARE_PARAM = "import";

/** Strip owner-only fields so a link carries just the loadout definition. */
export function shareableData(saved: SavedLoadout): SavedLoadoutData {
  const data: SavedLoadoutData = { version: LOADOUT_SCHEMA_VERSION, loadout: saved.loadout };
  if (saved.optimizer) data.optimizer = saved.optimizer;
  if (saved.builder) data.builder = saved.builder;
  return data;
}

export function buildShareUrl(origin: string, saved: SavedLoadout): string {
  const url = new URL("/loadouts", origin);
  url.hash = new URLSearchParams({ [SHARE_PARAM]: JSON.stringify(shareableData(saved)) }).toString();
  return url.toString();
}

/** The raw `import` value in a URL fragment (`#import=…`), or null. */
export function shareParamFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get(SHARE_PARAM);
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
