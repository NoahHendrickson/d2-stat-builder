import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { ManifestDefs } from "./manifest";
import { collectSocketPlugCandidates, extractPlugStatMods } from "./socket-plug-candidates";
import type { MasterworkOption } from "./types";

/** Y2+ weapon masterwork socket type hash (stat selection). */
export const WEAPON_MASTERWORK_SOCKET_TYPE_HASH = 2_218_962_841;

const MASTERWORK_STAT_PLUG_ID = /masterworks\.stat/i;
const COMPLETED_MASTERWORK_NAME_PREFIX = "Masterworked:";

function weaponDisplayStatHashes(item: DestinyInventoryItemDefinition): Set<number> {
  const hashes = new Set<number>();
  for (const stat of Object.values(item.stats?.stats ?? {})) {
    if (stat.value > 0) hashes.add(stat.statHash);
  }
  return hashes;
}

function isCompletedMasterworkStatPlug(def: DestinyInventoryItemDefinition): boolean {
  const id = def.plug?.plugCategoryIdentifier ?? "";
  const name = def.displayProperties?.name ?? "";
  return MASTERWORK_STAT_PLUG_ID.test(id) && name.startsWith(COMPLETED_MASTERWORK_NAME_PREFIX);
}

/** Collect full-tier masterwork stat options for one weapon item definition. */
export function buildWeaponMasterworkOptions(
  item: DestinyInventoryItemDefinition,
  items: Record<number, DestinyInventoryItemDefinition>,
  plugSets: ManifestDefs["DestinyPlugSetDefinition"],
  stats: ManifestDefs["DestinyStatDefinition"],
): MasterworkOption[] | undefined {
  const socketEntry = item.sockets?.socketEntries?.find(
    (entry) => entry.socketTypeHash === WEAPON_MASTERWORK_SOCKET_TYPE_HASH,
  );
  if (!socketEntry) return undefined;

  const displayStatHashes = weaponDisplayStatHashes(item);
  const candidates = collectSocketPlugCandidates(socketEntry, plugSets);
  const byStatHash = new Map<number, MasterworkOption>();

  for (const { hash } of candidates) {
    const def = items[hash];
    if (!def || !isCompletedMasterworkStatPlug(def)) continue;

    const statMods = extractPlugStatMods(def);
    const primaryMod = statMods?.[0];
    if (!primaryMod || !displayStatHashes.has(primaryMod.hash)) continue;
    if (byStatHash.has(primaryMod.hash)) continue;

    const statName = stats[primaryMod.hash]?.displayProperties?.name ?? `Stat ${primaryMod.hash}`;

    byStatHash.set(primaryMod.hash, {
      statHash: primaryMod.hash,
      statName,
      icon: def.displayProperties?.icon || undefined,
      statMods: statMods,
    });
  }

  if (byStatHash.size === 0) return undefined;

  return [...byStatHash.values()].sort((a, b) => a.statName.localeCompare(b.statName));
}
