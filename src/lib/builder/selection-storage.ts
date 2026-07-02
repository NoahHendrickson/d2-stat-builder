// Auto-persist the builder's selections to localStorage so a refresh / reopen restores
// them. Local to the browser; no backend, no cross-device sync. The pure helpers below are
// unit-tested; the two localStorage touchpoints are wrapped so a private-mode / quota /
// corrupt-data failure can never throw into React.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias, matching
// the convention in normalize.ts / solve.ts.
import { SUBCLASSES, type Subclass } from "../armory/fragments";

export const SELECTIONS_KEY = "stat-builder:selections";
export const SCHEMA_VERSION = 1;

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
  exoticName: string | null;
  allowTuning: boolean;
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
  if (!(typeof o.exoticName === "string" || o.exoticName === null)) return null;
  if (typeof o.allowTuning !== "boolean") return null;
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
    exoticName: o.exoticName as string | null,
    allowTuning: o.allowTuning as boolean,
    activeSubclass: o.activeSubclass as Subclass,
    fragSel,
  };
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
