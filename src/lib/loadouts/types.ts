// Saved-loadout data model + defensive parser. The parser is the single validation
// point for everything that crosses a trust boundary: API request bodies, database
// rows, and share-link imports. Anything malformed → null (never throws).
//
// Runtime imports are relative (not `@/`) so the module also runs under vitest.
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import type { AppliedTuning, OptimizerLoadout } from "../optimizer/types";
import { SUBCLASSES, type Subclass } from "../armory/fragments";

export const LOADOUT_SCHEMA_VERSION = 1;

/** Size caps — keep a single row small and reject junk early. */
export const MAX_NAME_LENGTH = 120;
export const MAX_NOTES_LENGTH = 4000;
const MAX_ITEMS = 12;
const MAX_MODS = 40;
const MAX_SOCKET_OVERRIDES = 24;
const MAX_ARTIFACT_UNLOCKS = 40;
const MAX_STAT_CONSTRAINTS = 6;
const MAX_SET_BONUSES = 8;

/**
 * The builder state a loadout was generated from — the parts DIM's `parameters` can't
 * express. Lets "Load in builder" restore the optimizer UI exactly. Mirrors
 * `PersistedSelections` minus list-display state (pins, set filters).
 */
export interface BuilderSnapshot {
  targets: number[];
  major: number;
  setReqs: Record<number, 2 | 4>;
  exoticName: string | null;
  exoticPerks: [number | null, number | null];
  allowTuning: boolean;
  balancedTuning: boolean;
  legacyExotics: boolean;
  activeSubclass: Subclass;
  /** Selected fragment hashes for `activeSubclass` only. */
  fragmentHashes: number[];
}

/** What the client sends to create/update; the server adds id + timestamps. */
export interface SavedLoadoutData {
  version: number;
  /** dim-api shape — source of truth for Open in DIM, share links, and apply. */
  loadout: DimLoadout;
  /**
   * The optimizer result the loadout was saved from (per-slot tuning/artifice picks,
   * stat breakdown). Absent for loadouts created another way (import, snapshot).
   */
  optimizer?: OptimizerLoadout;
  builder?: BuilderSnapshot;
}

export interface SavedLoadout extends SavedLoadoutData {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
}

// --- primitives ---

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function intArray(v: unknown, max: number): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  return v.every(isInt) ? (v as number[]) : null;
}

function statArray(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every(isFiniteNum)) return null;
  return v as number[];
}

/** JSON object keys are strings; accept numeric-looking keys and coerce. */
function intKeyedRecord(
  v: unknown,
  max: number,
  isValue: (x: unknown) => boolean,
): Record<number, number> | null {
  if (!isObj(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > max) return null;
  const out: Record<number, number> = {};
  for (const [k, val] of entries) {
    const key = Number(k);
    if (!Number.isInteger(key) || !isValue(val)) return null;
    out[key] = val as number;
  }
  return out;
}

const SUBCLASS_SET = new Set<string>(SUBCLASSES);

// --- DimLoadout ---

function parseItem(v: unknown): DimLoadoutItem | null {
  if (!isObj(v) || !isInt(v.hash)) return null;
  const item: DimLoadoutItem = { hash: v.hash };
  if (v.id !== undefined) {
    if (typeof v.id !== "string" || v.id.length > 64) return null;
    item.id = v.id;
  }
  if (v.socketOverrides !== undefined) {
    const so = intKeyedRecord(v.socketOverrides, MAX_SOCKET_OVERRIDES, isInt);
    if (!so) return null;
    item.socketOverrides = so;
  }
  return item;
}

function parseItems(v: unknown): DimLoadoutItem[] | null {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) return null;
  const out: DimLoadoutItem[] = [];
  for (const raw of v) {
    const item = parseItem(raw);
    if (!item) return null;
    out.push(item);
  }
  return out;
}

export function parseDimLoadout(v: unknown): DimLoadout | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== "string" || v.id.length > 64) return null;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (!isInt(v.classType) || v.classType < 0 || v.classType > 3) return null;
  const equipped = parseItems(v.equipped);
  const unequipped = parseItems(v.unequipped ?? []);
  if (!equipped || !unequipped) return null;
  if (!isObj(v.parameters)) return null;
  const p = v.parameters;
  const mods = intArray(p.mods ?? [], MAX_MODS);
  if (!mods) return null;
  if (!isInt(p.assumeArmorMasterwork)) return null;

  const loadout: DimLoadout = {
    id: v.id,
    name,
    classType: v.classType,
    equipped,
    unequipped,
    parameters: { mods, assumeArmorMasterwork: p.assumeArmorMasterwork },
  };

  if (v.notes !== undefined) {
    if (typeof v.notes !== "string" || v.notes.length > MAX_NOTES_LENGTH) return null;
    if (v.notes) loadout.notes = v.notes;
  }
  if (p.exoticArmorHash !== undefined) {
    if (!isInt(p.exoticArmorHash)) return null;
    loadout.parameters.exoticArmorHash = p.exoticArmorHash;
  }
  if (p.statConstraints !== undefined) {
    if (!Array.isArray(p.statConstraints) || p.statConstraints.length > MAX_STAT_CONSTRAINTS)
      return null;
    const out: { statHash: number; minStat: number }[] = [];
    for (const c of p.statConstraints) {
      if (!isObj(c) || !isInt(c.statHash) || !isInt(c.minStat)) return null;
      out.push({ statHash: c.statHash, minStat: c.minStat });
    }
    loadout.parameters.statConstraints = out;
  }
  if (p.setBonuses !== undefined) {
    const sb = intKeyedRecord(p.setBonuses, MAX_SET_BONUSES, (x) => x === 2 || x === 4);
    if (!sb) return null;
    loadout.parameters.setBonuses = sb;
  }
  if (p.artifactUnlocks !== undefined) {
    const a = p.artifactUnlocks;
    if (!isObj(a) || !isInt(a.seasonNumber)) return null;
    const hashes = intArray(a.unlockedItemHashes, MAX_ARTIFACT_UNLOCKS);
    if (!hashes) return null;
    loadout.parameters.artifactUnlocks = {
      unlockedItemHashes: hashes,
      seasonNumber: a.seasonNumber,
    };
  }
  return loadout;
}

// --- OptimizerLoadout ---

function parseTuning(v: unknown): AppliedTuning | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  if (v.kind === "balanced") return { kind: "balanced" };
  if (v.kind === "directional" && isInt(v.plus) && isInt(v.minus))
    return { kind: "directional", plus: v.plus, minus: v.minus };
  return undefined;
}

export function parseOptimizerLoadout(v: unknown): OptimizerLoadout | null {
  if (!isObj(v)) return null;
  if (
    !Array.isArray(v.pieceIds) ||
    v.pieceIds.length !== 5 ||
    !v.pieceIds.every((id) => typeof id === "string")
  )
    return null;
  const baseStats = statArray(v.baseStats);
  const stats = statArray(v.stats);
  const tuningBonus = statArray(v.tuningBonus);
  const modBonus = statArray(v.modBonus);
  const artificeBonus = statArray(v.artificeBonus);
  if (!baseStats || !stats || !tuningBonus || !modBonus || !artificeBonus) return null;
  if (!Array.isArray(v.tuning) || v.tuning.length !== 5) return null;
  const tuning: (AppliedTuning | null)[] = [];
  for (const t of v.tuning) {
    const parsed = parseTuning(t);
    if (parsed === undefined) return null;
    tuning.push(parsed);
  }
  if (
    !Array.isArray(v.artifice) ||
    v.artifice.length !== 5 ||
    !v.artifice.every((a) => a === null || isInt(a))
  )
    return null;
  if (!isObj(v.modsUsed) || !isInt(v.modsUsed.major) || !isInt(v.modsUsed.minor))
    return null;
  if (!isFiniteNum(v.total) || typeof v.exotic !== "boolean") return null;
  return {
    pieceIds: v.pieceIds as string[],
    baseStats,
    stats,
    tuningBonus,
    tuning,
    modBonus,
    modsUsed: { major: v.modsUsed.major, minor: v.modsUsed.minor },
    artificeBonus,
    artifice: v.artifice as (number | null)[],
    total: v.total,
    exotic: v.exotic,
  };
}

// --- BuilderSnapshot ---

export function parseBuilderSnapshot(v: unknown): BuilderSnapshot | null {
  if (!isObj(v)) return null;
  const targets = statArray(v.targets);
  if (!targets || !isInt(v.major)) return null;
  const setReqs = intKeyedRecord(v.setReqs ?? {}, MAX_SET_BONUSES, (x) => x === 2 || x === 4);
  if (!setReqs) return null;
  if (!(v.exoticName === null || typeof v.exoticName === "string")) return null;
  const ep = v.exoticPerks;
  if (!Array.isArray(ep) || ep.length !== 2 || !ep.every((x) => x === null || isInt(x)))
    return null;
  if (
    typeof v.allowTuning !== "boolean" ||
    typeof v.balancedTuning !== "boolean" ||
    typeof v.legacyExotics !== "boolean"
  )
    return null;
  if (typeof v.activeSubclass !== "string" || !SUBCLASS_SET.has(v.activeSubclass)) return null;
  const fragmentHashes = intArray(v.fragmentHashes ?? [], MAX_SOCKET_OVERRIDES);
  if (!fragmentHashes) return null;
  return {
    targets,
    major: v.major,
    setReqs: setReqs as Record<number, 2 | 4>,
    exoticName: v.exoticName,
    exoticPerks: [ep[0], ep[1]] as [number | null, number | null],
    allowTuning: v.allowTuning,
    balancedTuning: v.balancedTuning,
    legacyExotics: v.legacyExotics,
    activeSubclass: v.activeSubclass as Subclass,
    fragmentHashes,
  };
}

// --- SavedLoadout ---

/** Validate a client-supplied body (create / update / import). */
export function parseSavedLoadoutData(v: unknown): SavedLoadoutData | null {
  if (!isObj(v) || v.version !== LOADOUT_SCHEMA_VERSION) return null;
  const loadout = parseDimLoadout(v.loadout);
  if (!loadout) return null;
  const out: SavedLoadoutData = { version: LOADOUT_SCHEMA_VERSION, loadout };
  if (v.optimizer !== undefined && v.optimizer !== null) {
    const opt = parseOptimizerLoadout(v.optimizer);
    if (!opt) return null;
    out.optimizer = opt;
  }
  if (v.builder !== undefined && v.builder !== null) {
    const b = parseBuilderSnapshot(v.builder);
    if (!b) return null;
    out.builder = b;
  }
  return out;
}

/** Validate a full stored record (API response / database row). */
export function parseSavedLoadout(v: unknown): SavedLoadout | null {
  if (!isObj(v)) return null;
  const data = parseSavedLoadoutData(v);
  if (!data) return null;
  if (typeof v.id !== "string" || !v.id) return null;
  if (!isFiniteNum(v.createdAt) || !isFiniteNum(v.updatedAt)) return null;
  return { ...data, id: v.id, createdAt: v.createdAt, updatedAt: v.updatedAt };
}

/** Hashtags (`#pve`, `#raid`) from a loadout's name + notes, lower-cased and deduped. */
export function loadoutHashtags(loadout: Pick<DimLoadout, "name" | "notes">): string[] {
  const text = `${loadout.name} ${loadout.notes ?? ""}`;
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)) out.add(m[1].toLowerCase());
  return [...out];
}
