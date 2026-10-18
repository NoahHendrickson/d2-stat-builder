/**
 * A signed-in player's weapons for perk popularity. The profile route already
 * loads their whole profile with their own token, vault included whatever
 * their privacy settings, so it saves the weapons from it about once a day
 * (contribution-store.ts); each crawl run folds the ones saved since its last
 * run into the copy store as whole reads (scripts/fetch-popularity-contributions.ts),
 * through the same collector as the crawler's reads (popularity-reads.ts).
 *
 * The saved form is small and pure binary, no Node: version, flags, the copy
 * count, then per copy its instance id, item hash and plug hash per socket.
 * Weapons only (an instance with a damage type); which of them the tally
 * counts is decided when it's folded in, against that run's catalog.
 */

import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { ProfileCopy } from "./popularity-reads";

export interface Contribution {
  /** The read had the vault, character inventories and sockets, so it lists every weapon they have. */
  sawAll: boolean;
  copies: ProfileCopy[];
}

const VERSION = 1;
/** Flags bit: sawAll. */
const SAW_ALL = 1;
/** A copy's plug count when the read had no sockets for it. */
const NO_SOCKETS = 255;

/** Their weapons and when they last played, from a profile read with components 100, 102, 201, 205, 300 and 305; undefined when it lacks the instances to tell weapons apart. */
export function contributionFromProfile(
  profile: DestinyProfileResponse,
): { contribution: Contribution; lastPlayed: string | undefined } | undefined {
  const instances = profile.itemComponents?.instances?.data;
  if (!instances) return undefined;
  const vault = profile.profileInventory?.data?.items;
  const inventories = profile.characterInventories?.data;
  const sockets = profile.itemComponents?.sockets?.data;
  const items = [
    ...Object.values(profile.characterEquipment?.data ?? {}).flatMap((c) => c.items),
    ...Object.values(inventories ?? {}).flatMap((c) => c.items),
    ...(vault ?? []),
  ];
  const copies: ProfileCopy[] = [];
  for (const item of items) {
    const id = item.itemInstanceId;
    // Armor, ghosts and the rest have no damage type.
    if (!id || !instances[id]?.damageType) continue;
    copies.push({ itemHash: item.itemHash, id: BigInt(id), plugs: sockets?.[id]?.sockets.map((s) => s.plugHash) });
  }
  return {
    contribution: { sawAll: vault !== undefined && inventories !== undefined && sockets !== undefined, copies },
    lastPlayed: profile.profile?.data?.dateLastPlayed,
  };
}

export function encodeContribution({ sawAll, copies }: Contribution): Uint8Array {
  let size = 1 + 1 + 4;
  for (const copy of copies) size += 8 + 4 + 1 + (copy.plugs?.length ?? 0) * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, sawAll ? SAW_ALL : 0);
  view.setUint32(2, copies.length, true);
  let at = 6;
  for (const { id, itemHash, plugs } of copies) {
    if (plugs && plugs.length >= NO_SOCKETS) throw new Error(`An item with ${plugs.length} sockets.`);
    view.setBigUint64(at, id, true);
    view.setUint32(at + 8, itemHash, true);
    view.setUint8(at + 12, plugs ? plugs.length : NO_SOCKETS);
    at += 13;
    // 0 for an empty socket: no plug has hash 0.
    for (const plug of plugs ?? []) {
      view.setUint32(at, plug ?? 0, true);
      at += 4;
    }
  }
  return bytes;
}

export function decodeContribution(bytes: Uint8Array): Contribution {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== VERSION) throw new Error(`Contribution version ${view.getUint8(0)}; this reads ${VERSION}.`);
  const sawAll = (view.getUint8(1) & SAW_ALL) !== 0;
  const copies: ProfileCopy[] = Array.from({ length: view.getUint32(2, true) });
  let at = 6;
  for (let i = 0; i < copies.length; i++) {
    const id = view.getBigUint64(at, true);
    const itemHash = view.getUint32(at + 8, true);
    const count = view.getUint8(at + 12);
    at += 13;
    let plugs: (number | undefined)[] | undefined;
    if (count !== NO_SOCKETS) {
      plugs = [];
      for (let socket = 0; socket < count; socket++, at += 4) plugs.push(view.getUint32(at, true) || undefined);
    }
    copies[i] = { id, itemHash, plugs };
  }
  if (at !== bytes.byteLength) throw new Error("A damaged contribution.");
  return { sawAll, copies };
}
