import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { StatMod } from "./types";

type SocketPlugSetEntry = { plugItemHash: number; currentlyCanRoll?: boolean };

/** Socket entry subset needed for rollability heuristics. */
export interface SocketPlugSource {
  randomizedPlugSetHash?: number;
  reusablePlugSetHash?: number;
  singleInitialItemHash?: number;
}

/**
 * Whether a manifest plug-set entry should be treated as currently rollable.
 *
 * Bungie marks every plug in randomized pools `currentlyCanRoll: false` (all 6k+
 * legendary weapon perk sockets in the current manifest). Membership in the socket's
 * randomized plug set is the signal that a perk is in today's roll pool. The flag is
 * only meaningful for reusable-only pools (fixed/curated options).
 */
export function plugSetEntryCanRoll(
  socketEntry: SocketPlugSource,
  plugSetHash: number,
  plugEntry: SocketPlugSetEntry,
): boolean {
  if (
    socketEntry.randomizedPlugSetHash != null &&
    plugSetHash === socketEntry.randomizedPlugSetHash
  ) {
    return true;
  }
  return plugEntry.currentlyCanRoll ?? false;
}

/** Collect deduped plug candidates for one socket, OR-merging rollability per hash. */
export function collectSocketPlugCandidates(
  socketEntry: SocketPlugSource,
  plugSets: Record<number, { reusablePlugItems?: SocketPlugSetEntry[] }>,
): { hash: number; canRoll: boolean }[] {
  const byHash = new Map<number, boolean>();
  const plugSetHash = socketEntry.randomizedPlugSetHash ?? socketEntry.reusablePlugSetHash;

  if (plugSetHash != null) {
    for (const plug of plugSets[plugSetHash]?.reusablePlugItems ?? []) {
      const canRoll = plugSetEntryCanRoll(socketEntry, plugSetHash, plug);
      const existing = byHash.get(plug.plugItemHash);
      byHash.set(plug.plugItemHash, existing == null ? canRoll : existing || canRoll);
    }
  }
  if (socketEntry.singleInitialItemHash) {
    // Fixed socket plug (e.g. origin trait). Older raid weapons also list a crafting
    // empty-socket plug set on the same socket — merge this in regardless.
    const existing = byHash.get(socketEntry.singleInitialItemHash);
    byHash.set(socketEntry.singleInitialItemHash, existing == null ? true : existing || true);
  }

  return [...byHash.entries()].map(([hash, canRoll]) => ({ hash, canRoll }));
}

/** Non-conditional investment stat modifiers from a plug definition. */
export function extractPlugStatMods(def: DestinyInventoryItemDefinition): StatMod[] | undefined {
  const mods: StatMod[] = [];
  for (const inv of def.investmentStats ?? []) {
    if (inv.isConditionallyActive || inv.value === 0) continue;
    mods.push({ hash: inv.statTypeHash, value: inv.value });
  }
  return mods.length > 0 ? mods : undefined;
}
