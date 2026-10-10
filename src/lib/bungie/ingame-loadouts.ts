// In-game loadout slots (profile component 206) and the fixed name / icon / colour
// lists Bungie lets a slot be labelled with. Shared by the /api/bungie/ingame-loadouts
// route and the save dialog, so it must stay free of server-only imports.
import type { DestinyLoadoutComponent } from "bungie-api-ts/destiny2";

/** One piece of gear saved in a slot. */
export interface InGameLoadoutItem {
  itemInstanceId: string;
  /** Absent when the item is no longer in the inventory (dismantled since it was saved). */
  itemHash?: number;
}

/** One in-game loadout slot on a character. */
export interface InGameLoadoutSlot {
  /** Zero-based; the game shows it as slot `index + 1`. */
  index: number;
  nameHash: number;
  iconHash: number;
  colorHash: number;
  /** What the slot holds now, in the game's own order — the preview of what a save replaces. */
  items: InGameLoadoutItem[];
  /** Nothing saved here yet (its identifiers are placeholders). */
  empty: boolean;
}

/** The labels a slot can carry — Bungie's lists; there are no free-text names. */
export interface InGameLoadoutIdentifiers {
  names: { hash: number; name: string }[];
  /** Relative Bungie image paths. */
  icons: { hash: number; path: string }[];
  colors: { hash: number; path: string }[];
}

export interface InGameLoadoutsResponse {
  /** Only the slots this character has unlocked. */
  slots: InGameLoadoutSlot[];
  identifiers: InGameLoadoutIdentifiers;
}

export interface SlotIdentifiers {
  nameHash: number;
  iconHash: number;
  colorHash: number;
}

export interface SnapshotRequest extends SlotIdentifiers {
  characterId: string;
  loadoutIndex: number;
}

/** Generous: the game has 10 slots per character today (DestinyLoadoutConstantsDefinition). */
const MAX_LOADOUT_INDEX = 31;

/**
 * Bungie sends an unfilled slot as items with instance id 0 (or none at all); those
 * are dropped. `hashOf` resolves an instance id to its item hash from the inventory.
 */
export function toSlots(
  loadouts: readonly DestinyLoadoutComponent[],
  hashOf: (itemInstanceId: string) => number | undefined,
): InGameLoadoutSlot[] {
  return loadouts.map((l, index) => {
    const items = (l.items ?? [])
      .map((i) => String(i.itemInstanceId ?? "0"))
      .filter((id) => id !== "0")
      .map((id) => {
        const itemHash = hashOf(id);
        return itemHash === undefined ? { itemInstanceId: id } : { itemInstanceId: id, itemHash };
      });
    return {
      index,
      nameHash: l.nameHash,
      iconHash: l.iconHash,
      colorHash: l.colorHash,
      items,
      empty: items.length === 0,
    };
  });
}

/**
 * What a slot is labelled with unless the user picks otherwise: a filled slot keeps
 * its own identifiers (replacing the gear shouldn't rename it), an empty one — or one
 * whose identifier Bungie has since retired — gets the first of each list.
 */
export function defaultIdentifiers(
  slot: InGameLoadoutSlot | undefined,
  { names, icons, colors }: InGameLoadoutIdentifiers,
): SlotIdentifiers | undefined {
  if (!names.length || !icons.length || !colors.length) return undefined;
  const keep = (list: { hash: number }[], hash: number | undefined) =>
    slot && !slot.empty && list.some((d) => d.hash === hash) ? (hash as number) : list[0].hash;
  return {
    nameHash: keep(names, slot?.nameHash),
    iconHash: keep(icons, slot?.iconHash),
    colorHash: keep(colors, slot?.colorHash),
  };
}

const isUint32 = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

/** Bungie ids are int64s serialized as decimal strings. */
export function isBungieId(v: unknown): v is string {
  return typeof v === "string" && /^\d{1,20}$/.test(v);
}

/** Validate a client-supplied snapshot request; null if malformed. */
export function parseSnapshotRequest(body: unknown): SnapshotRequest | null {
  const b = body as Partial<SnapshotRequest> | null;
  if (!b || typeof b !== "object" || !isBungieId(b.characterId)) return null;
  if (
    !Number.isInteger(b.loadoutIndex) ||
    (b.loadoutIndex as number) < 0 ||
    (b.loadoutIndex as number) > MAX_LOADOUT_INDEX
  )
    return null;
  if (!isUint32(b.nameHash) || !isUint32(b.iconHash) || !isUint32(b.colorHash)) return null;
  return {
    characterId: b.characterId,
    loadoutIndex: b.loadoutIndex as number,
    nameHash: b.nameHash,
    iconHash: b.iconHash,
    colorHash: b.colorHash,
  };
}
