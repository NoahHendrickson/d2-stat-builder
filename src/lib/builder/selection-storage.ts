// Auto-persist the builder's selections to localStorage so a refresh / reopen restores
// them. Local to the browser; no backend, no cross-device sync. The pure helpers below are
// unit-tested; the two localStorage touchpoints are wrapped so a private-mode / quota /
// corrupt-data failure can never throw into React.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias, matching
// the convention in normalize.ts / solve.ts.
import { SUBCLASSES, type Subclass } from "../armory/fragments";
import { DEFAULT_SET_FILTERS, type SetFilters } from "../armory/set-filters";
import type { PowerRange } from "../optimizer/types";

export const SELECTIONS_KEY = "stat-builder:selections";
export const SCHEMA_VERSION = 1;

/** Inclusive gear-power bounds. */
export interface PowerBounds {
  min: number;
  max: number;
}

/**
 * The "Power matters" toggle: when `enabled`, builds must land their gear power — the
 * floor of the mean power over the five armor pieces and the weapons entered below —
 * inside `bounds`. `bounds` is null until the user (or the controls' first-enable seed)
 * sets it, and is kept while the toggle is off so switching it back on restores it.
 * Enabled with null bounds constrains nothing. `dreamersBond`, `legacyArmor` and the
 * weapon powers are likewise kept while off; they only act while `enabled` (see
 * forcesDreamersBond / includesLegacyArmor).
 */
export interface PowerRangeSelection {
  enabled: boolean;
  bounds: PowerBounds | null;
  /**
   * Power of the kinetic / energy / heavy weapons the build will be equipped with,
   * entered by hand. `null` = not entered, which leaves that slot out of the average.
   */
  weapons: [number | null, number | null, number | null];
  /**
   * Force the collections 21-power class item (Dreamer's Bond / Cloak / Mark) — 0
   * stats — into the class-item slot, so the other four pieces carry the build. A
   * power-range option because the 21 is the whole point: it drags the average down.
   */
  dreamersBond: boolean;
  /**
   * Let legacy (Armor 2.0) legendaries — no archetype, no tuning socket — into the
   * optimizer pool. Like the FotL masks, a power-range option: their power is what
   * makes them worth wearing, since they can't be tuned and join no set.
   */
  legacyArmor: boolean;
}

export const DEFAULT_POWER_RANGE: PowerRangeSelection = {
  enabled: false,
  bounds: null,
  weapons: [null, null, null],
  dreamersBond: false,
  legacyArmor: false,
};

/** Whether the class-item slot is pinned to Dreamer's Bond: only while Power matters is on. */
export function forcesDreamersBond(range: PowerRangeSelection): boolean {
  return range.enabled && range.dreamersBond;
}

/**
 * Whether legacy (Armor 2.0) legendaries join the pool: only while Power matters is
 * actually constraining (enabled with bounds), the same contract FotL masks use.
 */
export function includesLegacyArmor(range: PowerRangeSelection): boolean {
  return range.enabled && range.bounds !== null && range.legacyArmor;
}

/** The weapon powers that were actually entered, in slot order — what the solver averages in. */
export function enteredWeaponPowers(range: PowerRangeSelection): number[] {
  return range.weapons.filter((w): w is number => w !== null);
}

/**
 * Whether two selections mean the same thing — lets a control that re-commits the value
 * it already holds (a power field blurred untouched) skip the state update, and with it
 * the re-render, the debounced save, and the optimizer's key comparison.
 */
export function samePowerRangeSelection(
  a: PowerRangeSelection,
  b: PowerRangeSelection,
): boolean {
  if (a === b) return true;
  const bounds =
    a.bounds === b.bounds ||
    (a.bounds !== null &&
      b.bounds !== null &&
      a.bounds.min === b.bounds.min &&
      a.bounds.max === b.bounds.max);
  return (
    bounds &&
    a.enabled === b.enabled &&
    a.dreamersBond === b.dreamersBond &&
    a.legacyArmor === b.legacyArmor &&
    a.weapons.every((w, i) => w === b.weapons[i])
  );
}

/** The solver's view of the selection: undefined unless enabled with bounds set. */
export function toOptimizerPowerRange(range: PowerRangeSelection): PowerRange | undefined {
  if (!range.enabled || range.bounds === null) return undefined;
  return {
    min: range.bounds.min,
    max: range.bounds.max,
    weapons: enteredWeaponPowers(range),
  };
}

/**
 * The stored blob. Mirrors the builder's selection `useState`s, with two transforms:
 * the exotic is keyed by **name** (not its unstable live-inventory index), and `fragSel`'s
 * per-subclass `Set`s are flattened to arrays so JSON can round-trip them.
 */
export interface PersistedSelections {
  version: number;
  classType: number | null;
  targets: number[];
  major: number;
  setReqs: Record<number, 2 | 4>;
  /** Set hashes pinned to the top of the set-bonus list, in pin order. */
  pinnedSets: number[];
  /** Armor-set list display settings (ownership / piece-count toggles). */
  setFilters: SetFilters;
  exoticName: string | null;
  /**
   * Exotic class item Spirit selection: [left, right]. `null` in a column = Any.
   * Absent / ignored when the selected exotic is not a class item.
   */
  exoticPerks: [number | null, number | null];
  allowTuning: boolean;
  /** Let the optimizer apply Balanced Tuning (+1 off-stats) on tunable pieces. */
  balancedTuning: boolean;
  /** Include legacy (Armor 2.0 / non-tunable) exotics in the optimizer pool. */
  legacyExotics: boolean;
  /** Include Tier 1–4 Armor 3.0 legendaries (no tuning socket) in the optimizer pool. */
  lowerTierArmor: boolean;
  /** "Power matters": gear-power range, weapon powers, Dreamer's Bond (see PowerRangeSelection). */
  powerRange: PowerRangeSelection;
  activeSubclass: Subclass;
  fragSel: Record<Subclass, number[]>;
}

// --- pure helpers (unit-tested directly) ---

/** `Set`-per-subclass → array-per-subclass, for serialization. */
export function fragSelToArrays(
  s: Record<Subclass, Set<number>>,
): Record<Subclass, number[]> {
  return Object.fromEntries(
    SUBCLASSES.map((sc) => [sc, [...(s[sc] ?? [])]]),
  ) as Record<Subclass, number[]>;
}

/** array-per-subclass → `Set`-per-subclass, ignoring unknown keys and filling missing ones. */
export function fragSelFromArrays(
  a: Partial<Record<Subclass, number[]>>,
): Record<Subclass, Set<number>> {
  return Object.fromEntries(
    SUBCLASSES.map((sc) => [sc, new Set(a[sc] ?? [])]),
  ) as Record<Subclass, Set<number>>;
}

/**
 * Map a persisted exotic name back to its index in the current (live-inventory-derived)
 * exotics list. Returns null for no selection or an exotic the player no longer owns.
 */
export function resolveExoticIndex(
  name: string | null,
  exotics: { name: string }[],
): number | null {
  if (name === null) return null;
  const i = exotics.findIndex((e) => e.name === name);
  return i >= 0 ? i : null;
}

// --- storage I/O ---

function storage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    // Reading `localStorage` itself can throw in sandboxed / privacy contexts.
    return undefined;
  }
}

const SUBCLASS_SET = new Set<string>(SUBCLASSES);

function parseSetFilters(v: unknown): SetFilters {
  if (typeof v !== "object" || v === null) return DEFAULT_SET_FILTERS;
  const raw = v as Record<string, unknown>;
  const isLegacyShape = "only2pc" in raw || "only4pc" in raw;

  // Blobs from the old four-toggle schema auto-saved all-false defaults on every
  // debounced write — not an intentional user choice. Upgrade to the new defaults.
  if (
    isLegacyShape &&
    raw.hideZero === false &&
    raw.hideLessThan2 === false
  ) {
    return DEFAULT_SET_FILTERS;
  }

  // A stored `hideZero` (from the old two-toggle schema) is dropped: the single
  // "show sets under 2 pieces" option either hides both 0- and 1-piece sets or neither.
  return {
    hideLessThan2:
      typeof raw.hideLessThan2 === "boolean"
        ? raw.hideLessThan2
        : DEFAULT_SET_FILTERS.hideLessThan2,
  };
}

/** Parse + validate a stored string. Returns null on any malformed / stale / corrupt input. */
function parse(raw: string | null): PersistedSelections | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o.version !== SCHEMA_VERSION) return null;
  if (!(typeof o.classType === "number" || o.classType === null)) return null;
  if (
    !Array.isArray(o.targets) ||
    o.targets.length !== 6 ||
    !o.targets.every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return null;
  if (typeof o.major !== "number") return null;
  if (typeof o.setReqs !== "object" || o.setReqs === null) return null;
  // Optional (added after v1 shipped) — older stored blobs won't have it.
  const pinnedSets = Array.isArray(o.pinnedSets)
    ? o.pinnedSets.filter((n): n is number => typeof n === "number")
    : [];
  const setFilters = parseSetFilters(o.setFilters);
  if (!(typeof o.exoticName === "string" || o.exoticName === null)) return null;
  if (typeof o.allowTuning !== "boolean") return null;
  // Optional (added after v1 shipped) — older stored blobs won't have it. Default ON.
  const balancedTuning =
    typeof o.balancedTuning === "boolean" ? o.balancedTuning : true;
  // Optional (added after v1 shipped) — older stored blobs won't have it. Default ON.
  const legacyExotics =
    typeof o.legacyExotics === "boolean" ? o.legacyExotics : true;
  // Optional (added after v1 shipped) — older stored blobs won't have it. Default OFF:
  // it widens the pool with pieces that can't be tuned.
  const lowerTierArmor =
    typeof o.lowerTierArmor === "boolean" ? o.lowerTierArmor : false;
  // Optional — exotic class item Spirit pair; default Any/Any.
  const exoticPerks = parseExoticPerks(o.exoticPerks);
  // Optional (added after v1 shipped) — older stored blobs won't have it. Default OFF.
  const powerRange = parsePowerRange(o.powerRange);
  if (typeof o.activeSubclass !== "string" || !SUBCLASS_SET.has(o.activeSubclass))
    return null;
  if (typeof o.fragSel !== "object" || o.fragSel === null) return null;

  const fragRaw = o.fragSel as Record<string, unknown>;
  const fragSel = Object.fromEntries(
    SUBCLASSES.map((sc) => {
      const v = fragRaw[sc];
      const arr = Array.isArray(v)
        ? v.filter((n): n is number => typeof n === "number")
        : [];
      return [sc, arr];
    }),
  ) as Record<Subclass, number[]>;

  return {
    version: SCHEMA_VERSION,
    classType: o.classType as number | null,
    targets: o.targets as number[],
    major: o.major as number,
    setReqs: o.setReqs as Record<number, 2 | 4>,
    pinnedSets,
    setFilters,
    exoticName: o.exoticName as string | null,
    exoticPerks,
    allowTuning: o.allowTuning as boolean,
    balancedTuning,
    legacyExotics,
    lowerTierArmor,
    powerRange,
    activeSubclass: o.activeSubclass as Subclass,
    fragSel,
  };
}

/**
 * Validate a stored power range. Malformed / absent → the default (off, unset). Bounds
 * are null (unset) or a pair of non-negative integers, else the whole value is dropped
 * (a half-valid range would enable a constraint the user never chose); an inverted
 * pair is put in order rather than dropped, since the inputs commit on blur and a
 * debounced save can catch a min typed above the max. `dreamersBond` and `legacyArmor`
 * were added after the range shipped: absent reads as off.
 */
export function parsePowerRange(v: unknown): PowerRangeSelection {
  if (typeof v !== "object" || v === null) return DEFAULT_POWER_RANGE;
  const raw = v as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean") return DEFAULT_POWER_RANGE;
  const bounds = parsePowerBounds(raw.bounds);
  if (bounds === undefined) return DEFAULT_POWER_RANGE;
  return {
    enabled: raw.enabled,
    bounds,
    weapons: parseWeaponPowers(raw.weapons),
    dreamersBond: raw.dreamersBond === true,
    legacyArmor: raw.legacyArmor === true,
  };
}

/** null / absent → null (unset); a valid pair → ordered; anything else → undefined. */
function parsePowerBounds(v: unknown): PowerBounds | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return undefined;
  const { min, max } = v as Record<string, unknown>;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return undefined;
  if ((min as number) < 0 || (max as number) < 0) return undefined;
  return {
    min: Math.min(min as number, max as number),
    max: Math.max(min as number, max as number),
  };
}

/** Three optional non-negative integers; anything else → nothing entered. */
function parseWeaponPowers(v: unknown): PowerRangeSelection["weapons"] {
  if (!Array.isArray(v) || v.length !== 3) return [null, null, null];
  const slot = (x: unknown): number | null =>
    Number.isInteger(x) && (x as number) >= 0 ? (x as number) : null;
  return [slot(v[0]), slot(v[1]), slot(v[2])];
}

/** `[left, right]` Spirit hashes; `null` = Any. Malformed / absent → Any/Any. */
function parseExoticPerks(v: unknown): [number | null, number | null] {
  if (!Array.isArray(v) || v.length !== 2) return [null, null];
  const left = v[0] === null || typeof v[0] === "number" ? v[0] : null;
  const right = v[1] === null || typeof v[1] === "number" ? v[1] : null;
  return [left, right];
}

/** Read the stored selections, or null if absent / unreadable / stale / corrupt. */
export function loadSelections(): PersistedSelections | null {
  const s = storage();
  if (!s) return null;
  try {
    return parse(s.getItem(SELECTIONS_KEY));
  } catch {
    return null;
  }
}

/** Persist the selections (best-effort — quota / security errors are swallowed). */
export function saveSelections(sel: PersistedSelections): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SELECTIONS_KEY, JSON.stringify(sel));
  } catch {
    // Ignore quota / security errors — persistence is best-effort.
  }
}

/** Fired on `window` by `replaceSelections` so an already-mounted builder re-reads storage. */
export const SELECTIONS_REPLACED_EVENT = "stat-builder:selections-replaced";

/**
 * Persist `sel` as the builder's current selections and tell a mounted builder to adopt
 * them now — on its own it only reads storage on mount, so "Optimize" from the sidebar
 * while the optimizer view is already open would otherwise do nothing visible.
 */
export function replaceSelections(sel: PersistedSelections): void {
  saveSelections(sel);
  generation++;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SELECTIONS_REPLACED_EVENT));
  }
}

let generation = 0;

/**
 * Bumped by every `replaceSelections`. A builder whose effects were torn down while its
 * route was hidden misses the event; comparing this against the generation it last
 * adopted tells it to catch up when it becomes visible again.
 */
export function selectionsGeneration(): number {
  return generation;
}
