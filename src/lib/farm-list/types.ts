// Farm list data model + defensive parser: weapon rolls and armor pieces the player is
// hunting. The parser is the single validation point for request bodies and database
// rows: anything malformed → null (never throws).
//
// Runtime imports are relative (not `@/`) so the module also runs under vitest.
import { ARMOR_SLOTS, type ArmorSlot } from "../armory/stats";

export const FARM_LIST_SCHEMA_VERSION = 1;

/** Most entries one account may keep. */
export const MAX_FARM_ENTRIES_PER_ACCOUNT = 500;
/** Same-name versions one weapon entry matches (reissues; adept only with adept). */
const MAX_WEAPON_HASHES = 32;
/** A perk's plug hashes: base, enhanced, and any other tiers. */
const MAX_PERK_HASHES = 8;
/** Barrel, magazine, origin trait, masterwork, and the odd extra column. */
const MAX_EXTRAS = 8;
/** Copies an entry no longer counts; the oldest go first past this. */
export const MAX_IGNORED_COPIES = 200;
const MAX_TEXT = 120;
/** An archetype's tertiaries (4 today) with room to spare. */
const MAX_ARMOR_ROLLS = 6;
const NUM_STATS = 6;

/**
 * The weapon table column an extra goes in. Barrel and magazine are the weapon's first
 * and second component columns, whatever its type calls them (Blade, Guard, Scope, …).
 */
export type FarmColumn = "barrel" | "magazine" | "origin" | "masterwork" | "frame" | "other";
const FARM_COLUMNS: readonly FarmColumn[] = ["barrel", "magazine", "origin", "masterwork", "frame", "other"];

/** One picked perk. */
export interface FarmPerk {
  /** The column it was picked in ("Trait", "Barrel", "Blade", "Masterwork", …). */
  kind: string;
  /** Extras only: its column in the weapon table. */
  slot?: FarmColumn;
  /** Its name and icon when picked, so the Farm list draws without the catalog. */
  name: string;
  icon?: string;
  /** Every plug hash that counts as this perk: the base one first, then enhanced. */
  hashes: number[];
}

/** A weapon roll: what the client sends; the server adds the id, timestamps, and obtained state. */
export interface WeaponFarmData {
  kind: "weapon";
  version: number;
  /** The version the entry was made on. */
  weaponHash: number;
  weaponName: string;
  weaponIcon?: string;
  /** Every same-name version, adept only with adept, that can roll both traits. */
  weaponHashes: number[];
  /** The left and right perks, which every entry has. */
  traits: [FarmPerk, FarmPerk];
  /** Other picks. A drop has to have them too, except the masterwork (see requiredExtras). */
  extras: FarmPerk[];
  /** Copies that don't count: turned down with "Not this one" (older entries: also owned when made). */
  ignoredInstanceIds: string[];
}

/** A tertiary stat that will do, with the tuned stats that work alongside it. */
export interface ArmorFarmRoll {
  /** Stat index (STAT_ORDER). */
  tertiary: number;
  /** Stat indices; null = any tuned stat does. */
  tuned: number[] | null;
}

/** A Tier 5 armor piece of a required set, from a Theoretical build's row or a Dream build's replacement. */
export interface ArmorFarmData {
  kind: "armor";
  version: number;
  classType: number;
  slot: ArmorSlot;
  archetype: string;
  /** Stat indices of the archetype's 30 and 25, to draw it without the manifest. */
  primary: number;
  secondary: number;
  /** Any one of these counts. */
  rolls: ArmorFarmRoll[];
  /** The set bonus this piece is hunted for: every armor entry has one. */
  setHash: number;
  setName?: string;
  /** Copies that don't count: turned down with "Not this one" (older entries: also owned when made). */
  ignoredInstanceIds: string[];
}

export type FarmEntryData = WeaponFarmData | ArmorFarmData;

/** A copy that matched. */
export interface FarmObtained {
  instanceId: string;
  at: number;
  /** Seen on the Farm list page; until then the sidebar counts it. */
  seen: boolean;
  /** When the player kept it with Done: it stays on the list as a record of what they got. */
  doneAt?: number;
}

interface FarmEntryMeta {
  id: string;
  createdAt: number;
  obtained?: FarmObtained;
}

export type WeaponFarmEntry = WeaponFarmData & FarmEntryMeta;
export type ArmorFarmEntry = ArmorFarmData & FarmEntryMeta;
export type FarmEntry = WeaponFarmEntry | ArmorFarmEntry;

/** Finished with: a record of the drop, no longer something being hunted. */
export const isFarmDone = (entry: Pick<FarmEntryMeta, "obtained">): boolean => entry.obtained?.doneAt !== undefined;

const isHash = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;

const isStat = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < NUM_STATS;

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_TEXT ? v : undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function hashes(v: unknown, max: number): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.filter(isHash))].slice(0, max);
  return out.length > 0 ? out : null;
}

function parsePerk(v: unknown): FarmPerk | null {
  if (!isRecord(v)) return null;
  const kind = text(v.kind);
  const name = text(v.name);
  const perkHashes = hashes(v.hashes, MAX_PERK_HASHES);
  if (!kind || !name || !perkHashes) return null;
  const icon = text(v.icon);
  const slot = FARM_COLUMNS.find((s) => s === v.slot);
  return { kind, name, ...(icon ? { icon } : {}), ...(slot ? { slot } : {}), hashes: perkHashes };
}

/** Instance ids are decimal int64 strings. */
const isInstanceId = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v);

function parseIgnored(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter(isInstanceId))].slice(-MAX_IGNORED_COPIES) : [];
}

function parseWeapon(v: Record<string, unknown>): WeaponFarmData | null {
  const weaponName = text(v.weaponName);
  const weaponHashes = hashes(v.weaponHashes, MAX_WEAPON_HASHES);
  if (!isHash(v.weaponHash) || !weaponName || !weaponHashes) return null;
  if (!Array.isArray(v.traits) || v.traits.length !== 2) return null;
  const left = parsePerk(v.traits[0]);
  const right = parsePerk(v.traits[1]);
  if (!left || !right) return null;
  const extras = Array.isArray(v.extras)
    ? v.extras.map(parsePerk).filter((p): p is FarmPerk => p !== null).slice(0, MAX_EXTRAS)
    : [];
  const weaponIcon = text(v.weaponIcon);
  return {
    kind: "weapon",
    version: FARM_LIST_SCHEMA_VERSION,
    weaponHash: v.weaponHash,
    weaponName,
    ...(weaponIcon ? { weaponIcon } : {}),
    weaponHashes,
    traits: [left, right],
    extras,
    ignoredInstanceIds: parseIgnored(v.ignoredInstanceIds),
  };
}

function parseRoll(v: unknown): ArmorFarmRoll | null {
  if (!isRecord(v) || !isStat(v.tertiary)) return null;
  if (v.tuned === null) return { tertiary: v.tertiary, tuned: null };
  if (!Array.isArray(v.tuned) || v.tuned.length === 0 || !v.tuned.every(isStat)) return null;
  return { tertiary: v.tertiary, tuned: [...new Set(v.tuned as number[])] };
}

function parseArmor(v: Record<string, unknown>): ArmorFarmData | null {
  const archetype = text(v.archetype);
  const classType = v.classType;
  if (classType !== 0 && classType !== 1 && classType !== 2) return null;
  if (!archetype || !isStat(v.primary) || !isStat(v.secondary)) return null;
  const slot = ARMOR_SLOTS.find((s) => s === v.slot);
  if (slot === undefined || !isHash(v.setHash)) return null;
  if (!Array.isArray(v.rolls) || v.rolls.length === 0 || v.rolls.length > MAX_ARMOR_ROLLS) return null;
  const rolls = v.rolls.map(parseRoll);
  if (rolls.some((r) => r === null)) return null;
  const setName = text(v.setName);
  return {
    kind: "armor",
    version: FARM_LIST_SCHEMA_VERSION,
    classType,
    slot,
    archetype,
    primary: v.primary,
    secondary: v.secondary,
    rolls: rolls as ArmorFarmRoll[],
    setHash: v.setHash,
    ...(setName ? { setName } : {}),
    ignoredInstanceIds: parseIgnored(v.ignoredInstanceIds),
  };
}

export function parseFarmEntryData(v: unknown): FarmEntryData | null {
  if (!isRecord(v) || v.version !== FARM_LIST_SCHEMA_VERSION) return null;
  if (v.kind === "weapon") return parseWeapon(v);
  if (v.kind === "armor") return parseArmor(v);
  return null;
}

/** An entry as the API returns it (data plus id, timestamps, and obtained state). */
export function parseFarmEntry(v: unknown): FarmEntry | null {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.createdAt !== "number") return null;
  const data = parseFarmEntryData(v);
  if (!data) return null;
  let obtained: FarmObtained | undefined;
  if (isRecord(v.obtained)) {
    const o = v.obtained;
    if (isInstanceId(o.instanceId) && typeof o.at === "number")
      obtained = {
        instanceId: o.instanceId,
        at: o.at,
        seen: o.seen === true,
        ...(typeof o.doneAt === "number" ? { doneAt: o.doneAt } : {}),
      };
  }
  return { ...data, id: v.id, createdAt: v.createdAt, ...(obtained ? { obtained } : {}) };
}

/** A copy the client found that matches: `PATCH /api/farm-list/[id]`. */
export type FarmPatch =
  /** A drop matched: set obtained, unless it already is or the copy is ignored. */
  | { obtained: string }
  /** Not this one: ignore the obtained copy and go back to waiting. */
  | { reject: true }
  /** Done: keep the drop as a record. */
  | { done: true };

export function parseFarmPatch(v: unknown): FarmPatch | null {
  if (!isRecord(v)) return null;
  if (isInstanceId(v.obtained)) return { obtained: v.obtained };
  if (v.reject === true) return { reject: true };
  if (v.done === true) return { done: true };
  return null;
}
