// Auto-persist the armor table's filters + sort to localStorage so a refresh /
// reopen restores them (same best-effort pattern as builder/selection-storage.ts:
// no backend, malformed or stale data falls back to defaults, I/O never throws).
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import {
  CUSTOM_ORDER_COLUMNS,
  DEFAULT_SORT,
  emptyFilters,
  isSortKey,
  type ArmorVersion,
  type CustomOrders,
  type SortKey,
  type SortLevel,
  type SortState,
  type TableFilters,
  type TuningFilter,
} from "./filters";

export const TABLE_STATE_KEY = "stat-builder:armor-table";
/** v3: sort is an ordered nest chain (array). v2 single-object sorts migrate in. */
export const TABLE_SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_VERSION = 2;

export interface PersistedTableState {
  version: number;
  filters: TableFilters;
  sort: SortState;
  /** Per-column custom value orders (empty object = all defaults). */
  customOrders: CustomOrders;
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

function parseSortLevel(s: unknown): SortLevel | null {
  if (typeof s !== "object" || s === null) return null;
  const o = s as Record<string, unknown>;
  if (!isSortKey(o.key) || typeof o.asc !== "boolean") return null;
  if (REMOVED_SORT_KEYS.has(o.key)) return null;
  return { key: o.key as SortKey, asc: o.asc };
}

/**
 * Parse a nest chain. Accepts v3 arrays, v2 single objects, and null (unsorted).
 * Drops unknown / removed keys and duplicate columns. Explicit `[]` / null →
 * unsorted; a non-empty array that yields no valid levels → DEFAULT_SORT.
 */
function parseSort(s: unknown): SortState {
  if (s === null) return [];
  if (Array.isArray(s)) {
    const seen = new Set<SortKey>();
    const out: SortLevel[] = [];
    for (const item of s) {
      const level = parseSortLevel(item);
      if (!level || seen.has(level.key)) continue;
      seen.add(level.key);
      out.push(level);
    }
    if (out.length > 0) return out;
    return s.length === 0 ? [] : DEFAULT_SORT;
  }
  // v2 single-object shape → one-element chain.
  const level = parseSortLevel(s);
  if (level) return [level];
  return DEFAULT_SORT;
}

/** Keep only known columns with all-string value lists (else drop the column). */
function parseCustomOrders(v: unknown): CustomOrders {
  if (typeof v !== "object" || v === null) return {};
  const o = v as Record<string, unknown>;
  const out: CustomOrders = {};
  for (const col of CUSTOM_ORDER_COLUMNS) {
    const list = o[col];
    if (Array.isArray(list) && list.every((s) => typeof s === "string")) {
      out[col] = list;
    }
  }
  return out;
}

function parseFilters(f: Record<string, unknown>): TableFilters {
  return {
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
  const version = o.version;
  if (version !== TABLE_SCHEMA_VERSION && version !== LEGACY_SCHEMA_VERSION) {
    return null;
  }
  if (typeof o.filters !== "object" || o.filters === null) return null;

  const filters = parseFilters(o.filters as Record<string, unknown>);
  // v2 used null for unsorted; v3 uses [].
  const sort = parseSort(o.sort);
  const customOrders = parseCustomOrders(o.customOrders);

  return { version: TABLE_SCHEMA_VERSION, filters, sort, customOrders };
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
