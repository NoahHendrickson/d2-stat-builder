// "New drops" feed state: which armor instanceIds we've seen, and when each
// was first seen. A first-seen of 0 is the "acknowledged" sentinel — the piece
// is known but not feed-worthy (seeded on the first-ever visit so the whole
// vault doesn't flood the feed, or dismissed by the user). The feed is every
// entry with a non-zero timestamp, newest first.
//
// Same best-effort localStorage pattern as filter-storage.ts: malformed or
// stale data reads as null (harmless — the next reconcile re-seeds silently),
// I/O never throws.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.

export const DROPS_KEY = "stat-builder:armor-table-drops";
export const DROPS_SCHEMA_VERSION = 1;

/** instanceId → first-seen epoch ms; 0 = acknowledged (seeded or dismissed). */
export type SeenMap = Record<string, number>;

export interface PersistedDrops {
  version: number;
  seen: SeenMap;
}

/** Most entries the feed will surface at once. */
export const FEED_CAP = 50;

/**
 * Diff the current inventory against the stored map:
 * - `prev === null` (first-ever visit / corrupt store): every id → 0, so the
 *   existing collection seeds silently instead of flooding the feed.
 * - otherwise: known ids keep their timestamp, new ids are stamped `now`, and
 *   ids no longer in the inventory are dropped (dismantled → pruned).
 * Returns `prev` unchanged (same reference) when nothing changed, so callers
 * can skip re-saving and re-rendering.
 */
export function reconcileSeen(
  prev: SeenMap | null,
  currentIds: readonly string[],
  now: number,
): SeenMap {
  if (prev === null) {
    const seeded: SeenMap = {};
    for (const id of currentIds) seeded[id] = 0;
    return seeded;
  }
  let changed = false;
  const next: SeenMap = {};
  for (const id of currentIds) {
    if (id in prev) {
      next[id] = prev[id];
    } else {
      next[id] = now;
      changed = true;
    }
  }
  // Pruned entries change the map even when no new ids appeared.
  if (!changed && Object.keys(prev).length === currentIds.length) return prev;
  return next;
}

/** Dismiss one entry (no-op if already acknowledged or unknown). */
export function acknowledge(seen: SeenMap, id: string): SeenMap {
  if (!(id in seen) || seen[id] === 0) return seen;
  return { ...seen, [id]: 0 };
}

/** Clear the feed: every non-zero entry → acknowledged. */
export function acknowledgeAll(seen: SeenMap): SeenMap {
  if (Object.values(seen).every((v) => v === 0)) return seen;
  const next: SeenMap = {};
  for (const id of Object.keys(seen)) next[id] = 0;
  return next;
}

/** Feed-worthy entries (non-zero), newest first, capped. */
export function feedIds(
  seen: SeenMap,
  cap: number = FEED_CAP,
): { id: string; firstSeen: number }[] {
  return Object.entries(seen)
    .filter(([, firstSeen]) => firstSeen > 0)
    .map(([id, firstSeen]) => ({ id, firstSeen }))
    .sort((a, b) => b.firstSeen - a.firstSeen || a.id.localeCompare(b.id))
    .slice(0, cap);
}

function storage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    // Reading `localStorage` itself can throw in sandboxed / privacy contexts.
    return undefined;
  }
}

/** Parse + validate a stored string. Returns null on any malformed / stale input. */
function parse(raw: string | null): PersistedDrops | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o.version !== DROPS_SCHEMA_VERSION) return null;
  if (typeof o.seen !== "object" || o.seen === null) return null;
  const seen: SeenMap = {};
  for (const [id, value] of Object.entries(o.seen)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      seen[id] = value;
    }
  }
  return { version: DROPS_SCHEMA_VERSION, seen };
}

/** Read the stored drops state, or null if absent / unreadable / stale / corrupt. */
export function loadDrops(): PersistedDrops | null {
  const s = storage();
  if (!s) return null;
  try {
    return parse(s.getItem(DROPS_KEY));
  } catch {
    return null;
  }
}

/** Persist the drops state (best-effort — quota / security errors are swallowed). */
export function saveDrops(drops: PersistedDrops): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(DROPS_KEY, JSON.stringify(drops));
  } catch {
    // Ignore quota / security errors — persistence is best-effort.
  }
}
