import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { ManifestDefs } from "./manifest";
import { collectSocketPlugCandidates, extractPlugStatMods } from "./socket-plug-candidates";
import type { MasterworkOption } from "./types";

/** Y2+ weapon masterwork socket type hash (stat selection). */
export const WEAPON_MASTERWORK_SOCKET_TYPE_HASH = 2_218_962_841;

const MASTERWORK_STAT_PLUG_ID = /masterworks\.stat/i;
/** Frames, the enhanced ones a crafted weapon gets included. */
const INTRINSIC_PLUG_ID = "intrinsics";
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

/**
 * The enhanced frames a crafted copy of `item` can have, from its pattern's
 * frame socket, by each stat they add to outright (a fusion's list Draw Time
 * before its Charge Time): a crafted copy's masterwork is its enhanced frame.
 * The plain frame the socket starts with isn't one.
 */
function craftedFramesByStat(
  item: DestinyInventoryItemDefinition,
  items: Record<number, DestinyInventoryItemDefinition>,
  plugSets: ManifestDefs["DestinyPlugSetDefinition"],
): Map<number, number[]> {
  const recipe = items[item.inventory?.recipeItemHash ?? -1];
  const frames = (recipe?.sockets?.socketEntries ?? []).flatMap((entry) =>
    collectSocketPlugCandidates(entry, plugSets).flatMap(({ hash }) => {
      const def = items[hash];
      if (hash === entry.singleInitialItemHash || def?.plug?.plugCategoryIdentifier !== INTRINSIC_PLUG_ID) return [];
      return (def.investmentStats ?? [])
        .filter((stat) => !stat.isConditionallyActive && stat.value > 0)
        .map((stat) => ({ stat: stat.statTypeHash, hash }));
    }),
  );
  return new Map(
    [...Map.groupBy(frames, (frame) => frame.stat)].map(([stat, list]) => [stat, list.map((frame) => frame.hash)]),
  );
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
  // Every stat masterwork plug the socket can hold, any tier, by its stat's
  // plug category ("…masterworks.stat.range"): a copy holds one of these.
  const category = (hash: number) => items[hash]?.plug?.plugCategoryIdentifier ?? "";
  const byCategory = Map.groupBy(
    candidates.filter(({ hash }) => MASTERWORK_STAT_PLUG_ID.test(category(hash))),
    ({ hash }) => category(hash),
  );
  const craftedFrames = craftedFramesByStat(item, items, plugSets);

  for (const { hash } of candidates) {
    const def = items[hash];
    if (!def || !isCompletedMasterworkStatPlug(def)) continue;

    const statMods = extractPlugStatMods(def);
    const primaryMod = statMods?.[0];
    if (!primaryMod || !displayStatHashes.has(primaryMod.hash)) continue;
    if (byStatHash.has(primaryMod.hash)) continue;

    const statName = stats[primaryMod.hash]?.displayProperties?.name ?? `Stat ${primaryMod.hash}`;
    const masterworkPlugHashes = (byCategory.get(category(hash)) ?? [])
      .map((plug) => plug.hash)
      .filter((other) => other !== hash)
      .sort((a, b) => a - b);
    const craftedFrameHashes = [...(craftedFrames.get(primaryMod.hash) ?? [])].sort((a, b) => a - b);

    byStatHash.set(primaryMod.hash, {
      plugHash: hash,
      statHash: primaryMod.hash,
      statName,
      icon: def.displayProperties?.icon || undefined,
      statMods: statMods,
      ...(masterworkPlugHashes.length ? { masterworkPlugHashes } : {}),
      ...(craftedFrameHashes.length ? { craftedFrameHashes } : {}),
    });
  }

  if (byStatHash.size === 0) return undefined;

  return [...byStatHash.values()].sort((a, b) => a.statName.localeCompare(b.statName));
}
