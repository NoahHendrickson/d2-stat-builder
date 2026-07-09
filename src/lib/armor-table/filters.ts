// Armor-table filter model: every facet is a multi-select — OR within a facet,
// AND across facets, and an empty facet is inactive (no constraint).
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias,
// matching the convention in normalize.ts / solve.ts.
import { STAT_ORDER, type StatKey } from "../armory/stats";
import { nameMatchesSearch } from "./search";

/** A tuning facet value: a tuned-stat index, or "none" for untunable pieces. */
export type TuningFilter = number | "none";

/** Armor generation inferred from the tuning socket (same rule as the builder pool). */
export type ArmorVersion = "2.0" | "3.0";

/** The facet selections (search is kept separate so it can be deferred while typing). */
export interface FacetFilters {
  /** classType values (0 Titan, 1 Hunter, 2 Warlock). */
  classes: number[];
  setHashes: number[];
  /** Archetype plug names (e.g. "Gunner"). */
  archetypes: string[];
  tunings: TuningFilter[];
  /** Tertiary stat indices (0–5 in STAT_ORDER). */
  tertiaries: number[];
  armorVersions: ArmorVersion[];
}

/** Facets + search: the full filter state as persisted. */
export interface TableFilters extends FacetFilters {
  search: string;
}

export function emptyFacets(): FacetFilters {
  return {
    classes: [],
    setHashes: [],
    archetypes: [],
    tunings: [],
    tertiaries: [],
    armorVersions: [],
  };
}

export function emptyFilters(): TableFilters {
  return { ...emptyFacets(), search: "" };
}

export function hasActiveFilters(f: TableFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.classes.length > 0 ||
    f.setHashes.length > 0 ||
    f.archetypes.length > 0 ||
    f.tunings.length > 0 ||
    f.tertiaries.length > 0 ||
    f.armorVersions.length > 0
  );
}

/** The piece fields the filters read (structural subset of ArmorPiece). */
export interface FilterablePiece {
  name: string;
  classType: number;
  setHash?: number;
  archetype?: string;
  tunedStat?: number;
}

function pieceArmorVersion(piece: FilterablePiece): ArmorVersion {
  return piece.tunedStat !== undefined ? "3.0" : "2.0";
}

/**
 * AND across facets; a piece missing a field (no set, no archetype) fails that
 * facet when it's active. Search tokens are pre-computed by the caller (they're
 * shared across the whole pass).
 */
export function pieceMatchesFilters(
  piece: FilterablePiece,
  tertiary: number | undefined,
  f: FacetFilters,
  searchTokens: readonly string[],
): boolean {
  if (f.classes.length > 0 && !f.classes.includes(piece.classType)) return false;
  if (
    f.armorVersions.length > 0 &&
    !f.armorVersions.includes(pieceArmorVersion(piece))
  )
    return false;
  if (
    f.setHashes.length > 0 &&
    (piece.setHash === undefined || !f.setHashes.includes(piece.setHash))
  )
    return false;
  if (
    f.archetypes.length > 0 &&
    (piece.archetype === undefined || !f.archetypes.includes(piece.archetype))
  )
    return false;
  if (f.tunings.length > 0 && !f.tunings.includes(piece.tunedStat ?? "none"))
    return false;
  if (
    f.tertiaries.length > 0 &&
    (tertiary === undefined || !f.tertiaries.includes(tertiary))
  )
    return false;
  return nameMatchesSearch(piece.name, searchTokens);
}

// --- sorting ---

export type ColumnKey =
  | "name"
  | "class"
  | "archetype"
  | "tertiary"
  | "tuned"
  | "set";

/** Stat columns are namespaced ("stat-class") so they can't collide with the class column. */
export type SortKey = ColumnKey | `stat-${StatKey}`;

/** One level in a nestable sort chain. */
export interface SortLevel {
  key: SortKey;
  asc: boolean;
}

/** Ordered nest chain (primary → nested → …); empty = unsorted. */
export type SortState = SortLevel[];

export const DEFAULT_SORT: SortState = [{ key: "name", asc: true }];

const COLUMN_KEYS: ColumnKey[] = [
  "name",
  "class",
  "archetype",
  "tertiary",
  "tuned",
  "set",
];

export const SORT_KEYS = new Set<string>([
  ...COLUMN_KEYS,
  ...STAT_ORDER.map((key) => `stat-${key}`),
]);

export function isSortKey(key: unknown): key is SortKey {
  return typeof key === "string" && SORT_KEYS.has(key);
}

// --- custom value order ---

/** Columns whose values users can custom-order (categorical text columns). */
export const CUSTOM_ORDER_COLUMNS = [
  "class",
  "archetype",
  "tertiary",
  "tuned",
  "set",
] as const;

export type CustomOrderColumn = (typeof CUSTOM_ORDER_COLUMNS)[number];

/**
 * Per-column custom value order: ascending sorts listed values by index,
 * unlisted values after (alphabetically). Absent column → alphabetical.
 */
export type CustomOrders = Partial<Record<CustomOrderColumn, string[]>>;

export function isCustomOrderColumn(key: SortKey): key is CustomOrderColumn {
  return (CUSTOM_ORDER_COLUMNS as readonly string[]).includes(key);
}
