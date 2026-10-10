// Account-synced settings: the preferences that follow a player between computers.
// Shared by the client store (sync.ts) and the server route, so both validate a value
// the same way. Pure — runtime imports stay relative so the module runs under vitest.
import { parseLinks, type SavedLink } from "../links/links";
import { parseActivitySets, MAX_ACTIVITY_SETS, type ActivitySet } from "../loadouts/activity-sets";

export interface SettingValues {
  /** Sidebar bookmarks, in display order. */
  links: SavedLink[];
  /** Set hashes pinned to the top of the builder's set-bonus list, in pin order. */
  pinnedSets: number[];
  /** Saved loadouts assigned to in-game loadout slots, in display order. */
  activitySets: ActivitySet[];
}

export type SettingKey = keyof SettingValues;

/** A stored value plus when the server last wrote it (epoch ms, server clock). */
export interface StoredSetting<K extends SettingKey = SettingKey> {
  value: SettingValues[K];
  updatedAt: number;
}

/** `GET /api/settings`: the keys this account has ever written. */
export type StoredSettings = { [K in SettingKey]?: StoredSetting<K> };

export const SETTING_KEYS: readonly SettingKey[] = ["links", "pinnedSets", "activitySets"];

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

/** Caps so one account can't park arbitrary data in the table. */
export const MAX_LINKS = 100;
export const MAX_PINNED_SETS = 500;

function parsePinnedSets(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const n of value) {
    if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) seen.add(n);
  }
  return [...seen].slice(0, MAX_PINNED_SETS);
}

/**
 * A setting's value with malformed entries dropped, or null if it isn't the right
 * shape at all (not an array). The server stores what this returns.
 */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  value: unknown,
): SettingValues[K] | null {
  if (!Array.isArray(value)) return null;
  switch (key) {
    case "links":
      return parseLinks(value).slice(0, MAX_LINKS) as SettingValues[K];
    case "pinnedSets":
      return parsePinnedSets(value) as SettingValues[K];
    case "activitySets":
      return parseActivitySets(value) as SettingValues[K];
  }
  return null;
}

/**
 * The first sync on a browser that already has its own value: keep both rather than
 * let either computer's list wipe the other's. The account's list leads; local extras
 * follow (links matched by URL, pins by hash, activity sets by id).
 */
export function mergeSettingValues<K extends SettingKey>(
  key: K,
  local: SettingValues[K],
  server: SettingValues[K],
): SettingValues[K] {
  if (key === "links") {
    const s = server as SavedLink[];
    const urls = new Set(s.map((l) => l.url));
    const ids = new Set(s.map((l) => l.id));
    const extra = (local as SavedLink[])
      .filter((l) => !urls.has(l.url))
      .map((l) => (ids.has(l.id) ? { ...l, id: crypto.randomUUID() } : l));
    return [...s, ...extra].slice(0, MAX_LINKS) as SettingValues[K];
  }
  if (key === "activitySets") {
    const s = server as ActivitySet[];
    const ids = new Set(s.map((a) => a.id));
    return [...s, ...(local as ActivitySet[]).filter((a) => !ids.has(a.id))].slice(
      0,
      MAX_ACTIVITY_SETS,
    ) as SettingValues[K];
  }
  const s = server as number[];
  const have = new Set(s);
  return [...s, ...(local as number[]).filter((h) => !have.has(h))].slice(
    0,
    MAX_PINNED_SETS,
  ) as SettingValues[K];
}
