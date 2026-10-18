/**
 * A signed-in player's weapons for perk popularity. The profile route already
 * loads their whole profile with their own token, vault included whatever
 * their privacy settings, so it saves the weapons from it about once a day
 * (contribution-store.ts); each crawl run folds the ones saved since its last
 * run into the copy store as whole reads (scripts/fetch-popularity-contributions.ts),
 * through the same collector as the crawler's reads (popularity-reads.ts).
 *
 * The saved form is small and pure binary, no Node: version, flags, the copy
 * count, then per copy its instance id, item hash, whether it's equipped and
 * its plug hash per socket.
 * Weapons only (an instance with a damage type); which of them the tally
 * counts is decided when it's folded in, against that run's catalog.
 */

import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { profileCopies, type ProfileCopy } from "./popularity-reads";

export interface Contribution {
  /** The read had the vault, character inventories and sockets, so it lists every weapon they have. */
  sawAll: boolean;
  copies: ProfileCopy[];
}

/** 2: a flags byte per copy (1 had none, so whether a copy was equipped isn't known). */
const VERSION = 2;
/** Flags bit: sawAll. */
const SAW_ALL = 1;
/** A copy's flags bit: equipped. */
const EQUIPPED = 1;
/** A copy's plug count when the read had no sockets for it. */
const NO_SOCKETS = 255;

/**
 * Their weapons and when they last played, from a profile read with
 * components 100, 102, 201, 205, 300 and 305; undefined when it lacks the
 * instances to tell weapons apart. An item whose instance is missing can't be
 * told apart either, so the read then doesn't count as seeing everything.
 */
export function contributionFromProfile(
  profile: DestinyProfileResponse,
): { contribution: Contribution; lastPlayed: string | undefined } | undefined {
  const instances = profile.itemComponents?.instances?.data;
  if (!instances) return undefined;
  // Weapons have a damage type; armor, ghosts and the rest have none.
  const contribution = profileCopies(profile, ({ itemInstanceId }) => {
    const instance = instances[itemInstanceId];
    return instance ? instance.damageType > 0 : undefined;
  });
  return { contribution, lastPlayed: profile.profile?.data?.dateLastPlayed };
}

export function encodeContribution({ sawAll, copies }: Contribution): Uint8Array {
  let size = 1 + 1 + 4;
  for (const copy of copies) size += 8 + 4 + 1 + 1 + (copy.plugs?.length ?? 0) * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, sawAll ? SAW_ALL : 0);
  view.setUint32(2, copies.length, true);
  let at = 6;
  for (const { id, itemHash, plugs, equipped } of copies) {
    if (plugs && plugs.length >= NO_SOCKETS) throw new Error(`An item with ${plugs.length} sockets.`);
    view.setBigUint64(at, id, true);
    view.setUint32(at + 8, itemHash, true);
    // A profile read always says where a copy is, so a saved copy is equipped or not.
    view.setUint8(at + 12, equipped ? EQUIPPED : 0);
    view.setUint8(at + 13, plugs ? plugs.length : NO_SOCKETS);
    at += 14;
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
  const version = view.getUint8(0);
  if (version !== 1 && version !== VERSION) throw new Error(`Contribution version ${version}; this reads ${VERSION}.`);
  const sawAll = (view.getUint8(1) & SAW_ALL) !== 0;
  const copies: ProfileCopy[] = Array.from({ length: view.getUint32(2, true) });
  let at = 6;
  for (let i = 0; i < copies.length; i++) {
    const id = view.getBigUint64(at, true);
    const itemHash = view.getUint32(at + 8, true);
    at += 12;
    // A save from before each copy's flags were kept doesn't say whether it was equipped.
    let equipped: boolean | undefined;
    if (version >= 2) {
      equipped = (view.getUint8(at) & EQUIPPED) !== 0;
      at += 1;
    }
    const count = view.getUint8(at);
    at += 1;
    let plugs: (number | undefined)[] | undefined;
    if (count !== NO_SOCKETS) {
      plugs = [];
      for (let socket = 0; socket < count; socket++, at += 4) plugs.push(view.getUint32(at, true) || undefined);
    }
    copies[i] = { id, itemHash, plugs, equipped };
  }
  if (at !== bytes.byteLength) throw new Error("A damaged contribution.");
  return { sawAll, copies };
}
