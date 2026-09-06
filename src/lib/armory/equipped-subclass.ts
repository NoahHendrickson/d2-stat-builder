import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import {
  FRAGMENT_SOCKET_START,
  FRAGMENT_SOCKET_COUNT,
  ASPECT_SOCKET_COUNT,
  SUPER_SOCKET_COUNT,
  aspectSocketStart,
  subclassFromItemHash,
} from "@/lib/dim/subclasses";
import type { Subclass } from "./fragments";

export { FRAGMENT_SOCKET_COUNT } from "@/lib/dim/subclasses";

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
  /** Live plug hash per fragment socket index (absent = empty / unknown / locked). */
  fragmentSockets: Record<number, number>;
  aspectSockets: Record<number, number>;
  superSockets: Record<number, number>;
}

/**
 * Every subclass item on a character (equipped + inventory) with its live fragment
 * sockets — what applying a loadout needs to equip the right subclass and plan
 * fragment inserts. Fragment slots the player hasn't unlocked yet (Bungie reports them
 * as not visible / not enabled) are left out, so the planner never targets a locked
 * socket; a zero plug (nothing socketed) is left out too.
 */
export function subclassItemsForCharacter(
  profile: DestinyProfileResponse,
  characterId: string,
  superIndexFor?: (itemHash: number) => number | undefined,
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
      const aspectSockets: Record<number, number> = {};
      const superSockets: Record<number, number> = {};
      const superStart = superIndexFor?.(item.itemHash);
      if (superStart !== undefined) {
        for (let i = superStart; i < superStart + SUPER_SOCKET_COUNT; i++) {
          const socket = sockets[i];
          if (socket?.plugHash && socket.isVisible !== false && socket.isEnabled !== false) superSockets[i] = socket.plugHash;
        }
      }
      for (let i = aspectSocketStart(subclass); i < aspectSocketStart(subclass) + ASPECT_SOCKET_COUNT; i++) {
        const socket = sockets[i];
        if (socket?.plugHash && socket.isVisible !== false && socket.isEnabled !== false) aspectSockets[i] = socket.plugHash;
      }
      for (let i = start; i < start + FRAGMENT_SOCKET_COUNT; i++) {
        const socket = sockets[i];
        if (!socket?.plugHash) continue;
        if (socket.isVisible === false || socket.isEnabled === false) continue;
        fragmentSockets[i] = socket.plugHash;
      }
      out.push({
        itemHash: item.itemHash,
        instanceId: item.itemInstanceId,
        subclass,
        equipped,
        fragmentSockets,
        aspectSockets,
        superSockets,
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
  const equipped = subclassItemsForCharacter(profile, characterId).find((s) => s.equipped);
  if (!equipped) return undefined;
  // Integer keys enumerate in ascending order — socket order.
  return { subclass: equipped.subclass, fragmentHashes: Object.values(equipped.fragmentSockets) };
}
