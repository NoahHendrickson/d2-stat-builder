import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import {
  FRAGMENT_SOCKET_START,
  subclassFromItemHash,
} from "@/lib/dim/subclasses";
import type { Subclass } from "./fragments";

export const FRAGMENT_SOCKET_COUNT = 6;

export interface EquippedSubclass {
  subclass: Subclass;
  /** Plug hashes in fragment sockets (may include non-stat fragments). */
  fragmentHashes: number[];
}

/** One subclass item a character owns (all subclasses live on the character). */
export interface SubclassItem {
  itemHash: number;
  instanceId: string;
  subclass: Subclass;
  equipped: boolean;
  /** Live plug hash per fragment socket index (absent = empty / unknown). */
  fragmentSockets: Record<number, number>;
}

/**
 * Every subclass item on a character (equipped + inventory) with its live fragment
 * sockets — what applying a loadout needs to equip the right subclass and plan
 * fragment inserts.
 */
export function subclassItemsForCharacter(
  profile: DestinyProfileResponse,
  characterId: string,
): SubclassItem[] {
  const out: SubclassItem[] = [];
  const collect = (
    items: { itemHash: number; itemInstanceId?: string }[] | undefined,
    equipped: boolean,
  ) => {
    for (const item of items ?? []) {
      const subclass = subclassFromItemHash(item.itemHash);
      if (!subclass || !item.itemInstanceId) continue;
      const sockets =
        profile.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets ?? [];
      const start = FRAGMENT_SOCKET_START[subclass];
      const fragmentSockets: Record<number, number> = {};
      for (let i = start; i < start + FRAGMENT_SOCKET_COUNT; i++) {
        const plugHash = sockets[i]?.plugHash;
        if (plugHash) fragmentSockets[i] = plugHash;
      }
      out.push({
        itemHash: item.itemHash,
        instanceId: item.itemInstanceId,
        subclass,
        equipped,
        fragmentSockets,
      });
    }
  };
  collect(profile.characterEquipment?.data?.[characterId]?.items, true);
  collect(profile.characterInventories?.data?.[characterId]?.items, false);
  return out;
}

/** Equipped subclass + fragment plug hashes for one character, or undefined if none. */
export function equippedSubclassForCharacter(
  profile: DestinyProfileResponse,
  characterId: string,
): EquippedSubclass | undefined {
  const items = profile.characterEquipment?.data?.[characterId]?.items;
  if (!items) return undefined;

  let subclass: Subclass | undefined;
  let instanceId: string | undefined;
  for (const item of items) {
    const sc = subclassFromItemHash(item.itemHash);
    if (sc && item.itemInstanceId) {
      subclass = sc;
      instanceId = item.itemInstanceId;
      break;
    }
  }
  if (!subclass || !instanceId) return undefined;

  const sockets =
    profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const start = FRAGMENT_SOCKET_START[subclass];
  const fragmentHashes: number[] = [];
  for (let i = 0; i < FRAGMENT_SOCKET_COUNT; i++) {
    const plugHash = sockets[start + i]?.plugHash;
    if (plugHash) fragmentHashes.push(plugHash);
  }

  return { subclass, fragmentHashes };
}
