// Persist the armor table's pinned filter options (Sets + Archetypes) to
// localStorage, in pin order. Same best-effort pattern as filter-storage.ts:
// malformed or stale data falls back to defaults, I/O never throws. Kept
// separate from the builder's pinnedSets — those prioritize the set-bonus
// picker; these order a filter dropdown.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.

export const TABLE_PINS_KEY = "stat-builder:armor-table-pins";
export const PINS_SCHEMA_VERSION = 1;

export interface PersistedTablePins {
  version: number;
  /** Set hashes pinned in the Sets filter, in pin order. */
  sets: number[];
  /** Archetype names pinned in the Archetypes filter, in pin order. */
  archetypes: string[];
}

function storage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    // Reading `localStorage` itself can throw in sandboxed / privacy contexts.
    return undefined;
  }
}

const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** Parse + validate a stored string. Returns null on any malformed / stale input. */
function parse(raw: string | null): PersistedTablePins | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o.version !== PINS_SCHEMA_VERSION) return null;
  return {
    version: PINS_SCHEMA_VERSION,
    sets: numbers(o.sets),
    archetypes: strings(o.archetypes),
  };
}

/** Read the stored pins, or null if absent / unreadable / stale / corrupt. */
export function loadTablePins(): PersistedTablePins | null {
  const s = storage();
  if (!s) return null;
  try {
    return parse(s.getItem(TABLE_PINS_KEY));
  } catch {
    return null;
  }
}

/** Persist the pins (best-effort — quota / security errors are swallowed). */
export function saveTablePins(pins: PersistedTablePins): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(TABLE_PINS_KEY, JSON.stringify(pins));
  } catch {
    // Ignore quota / security errors — persistence is best-effort.
  }
}
