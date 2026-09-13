// Self-contained share links: the loadout travels inside the URL (same mechanism as
// DIM's `/loadouts?loadout=` handoff), so sharing needs no backend row and a recipient
// who isn't the owner still gets a full copy. Runtime imports are relative for vitest.
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
  const url = new URL("/", origin);
  url.searchParams.set(SHARE_PARAM, JSON.stringify(shareableData(saved)));
  return url.toString();
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
