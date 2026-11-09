// Activity sets: saved loadouts assigned to a character's in-game loadout slots, so one
// click saves them all into the game (see activity-set-run.ts). Stored as an
// account-synced setting (settings/keys.ts). Pure — runtime imports stay relative so
// the module runs under vitest.
import type { ArmorPiece } from "../armory/normalize";
import { parseSlotIdentifiers, type SlotIdentifiers } from "../bungie/ingame-loadouts";
import type { SavedLoadout } from "./types";

/** One in-game slot and the saved loadout that goes into it. */
export interface ActivitySetSlot {
  /** Zero-based in-game slot; the game shows it as `index + 1`. */
  index: number;
  loadoutId: string;
  /** The name, icon and colour to give the slot; without them it keeps its own. */
  labels?: SlotIdentifiers;
}

export interface ActivitySet {
  id: string;
  name: string;
  /** In-game loadouts belong to one character, so a set does too. */
  characterId: string;
  /** Kept so a set still reads "Hunter" if its character is deleted. */
  classType: number;
  /** One entry per assigned slot, in slot order; unassigned slots are left alone. */
  slots: ActivitySetSlot[];
}

export const MAX_ACTIVITY_SETS = 50;
export const MAX_ACTIVITY_SET_NAME_LENGTH = 60;
/** Generous: the game has 10 slots per character today. */
const MAX_SLOT_INDEX = 31;
const MAX_ID_LENGTH = 64;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;

function parseSlots(v: unknown): ActivitySetSlot[] | null {
  if (!Array.isArray(v)) return null;
  const byIndex = new Map<number, ActivitySetSlot>();
  for (const s of v) {
    if (!isObj(s) || !Number.isInteger(s.index) || !isId(s.loadoutId)) continue;
    const index = s.index as number;
    if (index < 0 || index > MAX_SLOT_INDEX) continue;
    const labels = parseSlotIdentifiers(s.labels);
    byIndex.set(index, { index, loadoutId: s.loadoutId, ...(labels && { labels }) });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function parseActivitySet(v: unknown): ActivitySet | null {
  if (!isObj(v) || !isId(v.id) || !/^\d{1,20}$/.test(String(v.characterId))) return null;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name || name.length > MAX_ACTIVITY_SET_NAME_LENGTH) return null;
  if (!Number.isInteger(v.classType) || (v.classType as number) < 0 || (v.classType as number) > 2)
    return null;
  const slots = parseSlots(v.slots);
  if (!slots) return null;
  return {
    id: v.id,
    name,
    characterId: String(v.characterId),
    classType: v.classType as number,
    slots,
  };
}

/** Well-formed sets only, deduped by id, capped. */
export function parseActivitySets(value: unknown[]): ActivitySet[] {
  const seen = new Set<string>();
  const out: ActivitySet[] = [];
  for (const raw of value) {
    const set = parseActivitySet(raw);
    if (!set || seen.has(set.id)) continue;
    seen.add(set.id);
    out.push(set);
  }
  return out.slice(0, MAX_ACTIVITY_SETS);
}

/**
 * `set` with one slot assigned, or left alone when `loadoutId` is undefined; slots stay in
 * order. Swapping the loadout in a slot keeps the labels chosen for it.
 */
export function withSlotAssignment(
  set: ActivitySet,
  index: number,
  loadoutId: string | undefined,
): ActivitySet {
  const others = set.slots.filter((s) => s.index !== index);
  const current = set.slots.find((s) => s.index === index);
  return {
    ...set,
    slots: (loadoutId ? [...others, { ...current, index, loadoutId }] : others).sort(
      (a, b) => a.index - b.index,
    ),
  };
}

/** `set` with the name, icon and colour chosen for one of its slots. */
export function withSlotLabels(set: ActivitySet, index: number, labels: SlotIdentifiers): ActivitySet {
  return { ...set, slots: set.slots.map((s) => (s.index === index ? { ...s, labels } : s)) };
}

/**
 * The sets to list for a character: its own, plus any whose character has left the
 * account (so they can still be found and deleted).
 */
export function activitySetsForCharacter(
  sets: readonly ActivitySet[],
  characterId: string | undefined,
  accountCharacterIds: readonly string[],
): ActivitySet[] {
  return sets.filter(
    (s) => s.characterId === characterId || !accountCharacterIds.includes(s.characterId),
  );
}

/** Whether a working copy of a set matches the saved one; spaces around the name don't count. */
export function sameActivitySet(a: ActivitySet, b: ActivitySet): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.slots.length === b.slots.length &&
    a.slots.every(
      (s, i) =>
        s.index === b.slots[i].index &&
        s.loadoutId === b.slots[i].loadoutId &&
        s.labels?.nameHash === b.slots[i].labels?.nameHash &&
        s.labels?.iconHash === b.slots[i].labels?.iconHash &&
        s.labels?.colorHash === b.slots[i].labels?.colorHash,
    )
  );
}

/**
 * The set-only loadouts a change to the sets just left unused: referenced before, by no
 * set after. Loadouts from the player's own list are never returned.
 */
export function orphanedSetLoadouts(
  before: readonly ActivitySet[],
  after: readonly ActivitySet[],
  loadouts: readonly Pick<SavedLoadout, "id" | "setOnly">[],
): string[] {
  const ids = (sets: readonly ActivitySet[]) =>
    new Set(sets.flatMap((s) => s.slots.map((slot) => slot.loadoutId)));
  const kept = ids(after);
  const dropped = [...ids(before)].filter((id) => !kept.has(id));
  return dropped.filter((id) => loadouts.find((l) => l.id === id)?.setOnly === true);
}

/** The class a saved loadout is for; an any-class loadout takes its armor's class. */
export function loadoutClassType(
  saved: SavedLoadout,
  pieceMap: ReadonlyMap<string, Pick<ArmorPiece, "classType">>,
): number | undefined {
  const { classType, equipped } = saved.loadout;
  if (classType < 3) return classType;
  for (const ref of equipped) {
    const piece = ref.id ? pieceMap.get(ref.id) : undefined;
    if (piece) return piece.classType;
  }
  return undefined;
}
