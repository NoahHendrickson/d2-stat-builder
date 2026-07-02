// Auto-persist the armor table's filters + sort to localStorage so a refresh /
// reopen restores them (same best-effort pattern as builder/selection-storage.ts:
// no backend, malformed or stale data falls back to defaults, I/O never throws).
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import {
  DEFAULT_SORT,
  emptyFilters,
  isSortKey,
  type ArmorVersion,
  type SortState,
  type TableFilters,
  type TuningFilter,
} from "./filters";

export const TABLE_STATE_KEY = "stat-builder:armor-table";
export const TABLE_SCHEMA_VERSION = 2;

export interface PersistedTableState {
  version: number;
  filters: TableFilters;
  sort: SortState;
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

const ARMOR_VERSION_SET = new Set<string>(["2.0", "3.0"]);

const armorVersions = (v: unknown): ArmorVersion[] =>
  strings(v).filter((s): s is ArmorVersion => ARMOR_VERSION_SET.has(s));

const REMOVED_SORT_KEYS = new Set(["slot", "location"]);

function parseSort(s: Record<string, unknown> | null | undefined): SortState {
  if (!s || !isSortKey(s.key) || typeof s.asc !== "boolean") return DEFAULT_SORT;
  if (REMOVED_SORT_KEYS.has(s.key)) return DEFAULT_SORT;
  return { key: s.key, asc: s.asc };
}

/** Parse + validate a stored string. Returns null on any malformed / stale / corrupt input. */
function parse(raw: string | null): PersistedTableState | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o.version !== TABLE_SCHEMA_VERSION) return null;
  if (typeof o.filters !== "object" || o.filters === null) return null;
  const f = o.filters as Record<string, unknown>;

  const filters: TableFilters = {
    ...emptyFilters(),
    search: typeof f.search === "string" ? f.search : "",
    classes: numbers(f.classes),
    setHashes: numbers(f.setHashes),
    archetypes: strings(f.archetypes),
    tunings: Array.isArray(f.tunings)
      ? f.tunings.filter(
          (t): t is TuningFilter => typeof t === "number" || t === "none",
        )
      : [],
    tertiaries: numbers(f.tertiaries),
    armorVersions: armorVersions(f.armorVersions),
  };

  const sort = parseSort(o.sort as Record<string, unknown> | null | undefined);

  return { version: TABLE_SCHEMA_VERSION, filters, sort };
}

/** Read the stored table state, or null if absent / unreadable / stale / corrupt. */
export function loadTableState(): PersistedTableState | null {
  const s = storage();
  if (!s) return null;
  try {
    return parse(s.getItem(TABLE_STATE_KEY));
  } catch {
    return null;
  }
}

/** Persist the table state (best-effort — quota / security errors are swallowed). */
export function saveTableState(state: PersistedTableState): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(TABLE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / security errors — persistence is best-effort.
  }
}
