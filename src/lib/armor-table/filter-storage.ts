// Auto-persist the armor table's filters + sort to localStorage so a refresh /
// reopen restores them (same best-effort pattern as builder/selection-storage.ts:
// no backend, malformed or stale data falls back to defaults, I/O never throws).
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import {
  CUSTOM_ORDER_COLUMNS,
  DEFAULT_SORT,
  emptyFilters,
  isCustomOrderColumn,
  isSortKey,
  type ArmorVersion,
  type CustomOrderColumn,
  type SortKey,
  type SortLevel,
  type SortState,
  type TableFilters,
  type TuningFilter,
} from "./filters";

export const TABLE_STATE_KEY = "stat-builder:armor-table";
/**
 * v4: each nest level is a discriminated union (`dir` | `custom` with order).
 * v3: `{ key, asc }[]` + parallel `customOrders` map — merged on load.
 * v2: single `{ key, asc }` or null — wrapped into a one-element chain.
 */
export const TABLE_SCHEMA_VERSION = 4;
const LEGACY_SCHEMA_VERSIONS = new Set([2, 3]);

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

type LegacyCustomOrders = Partial<Record<CustomOrderColumn, string[]>>;

function parseLegacyCustomOrders(v: unknown): LegacyCustomOrders {
  if (typeof v !== "object" || v === null) return {};
  const o = v as Record<string, unknown>;
  const out: LegacyCustomOrders = {};
  for (const col of CUSTOM_ORDER_COLUMNS) {
    const list = o[col];
    if (Array.isArray(list) && list.every((s) => typeof s === "string")) {
      out[col] = list;
    }
  }
  return out;
}

function parseSortLevel(
  s: unknown,
  legacyOrders: LegacyCustomOrders,
): SortLevel | null {
  if (typeof s !== "object" || s === null) return null;
  const o = s as Record<string, unknown>;
  if (!isSortKey(o.key) || REMOVED_SORT_KEYS.has(o.key)) return null;
  const key = o.key as SortKey;

  // v4 discriminated union.
  if (o.kind === "custom") {
    if (!isCustomOrderColumn(key)) return null;
    if (!Array.isArray(o.order) || !o.order.every((x) => typeof x === "string")) {
      return null;
    }
    return { key, kind: "custom", order: o.order as string[] };
  }
  if (o.kind === "dir") {
    if (typeof o.asc !== "boolean") return null;
    return { key, kind: "dir", asc: o.asc };
  }

  // v2/v3 `{ key, asc }` — promote to custom when a legacy order exists.
  if (typeof o.asc !== "boolean") return null;
  if (isCustomOrderColumn(key) && legacyOrders[key] !== undefined) {
    return { key, kind: "custom", order: legacyOrders[key]! };
  }
  return { key, kind: "dir", asc: o.asc };
}

/**
 * Parse a nest chain. Accepts v4 unions, v3 `{key,asc}[]` (+ legacy orders),
 * v2 single objects, and null (unsorted).
 */
function parseSort(s: unknown, legacyOrders: LegacyCustomOrders): SortState {
  if (s === null) return [];
  if (Array.isArray(s)) {
    const seen = new Set<SortKey>();
    const out: SortLevel[] = [];
    for (const item of s) {
      const level = parseSortLevel(item, legacyOrders);
      if (!level || seen.has(level.key)) continue;
      seen.add(level.key);
      out.push(level);
    }
    if (out.length > 0) return out;
    return s.length === 0 ? [] : DEFAULT_SORT;
  }
  const level = parseSortLevel(s, legacyOrders);
  if (level) return [level];
  return DEFAULT_SORT;
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
  if (
    version !== TABLE_SCHEMA_VERSION &&
    !LEGACY_SCHEMA_VERSIONS.has(version as number)
  ) {
    return null;
  }
  if (typeof o.filters !== "object" || o.filters === null) return null;

  const filters = parseFilters(o.filters as Record<string, unknown>);
  const legacyOrders =
    version === 2 || version === 3
      ? parseLegacyCustomOrders(o.customOrders)
      : {};
  const sort = parseSort(o.sort, legacyOrders);

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
