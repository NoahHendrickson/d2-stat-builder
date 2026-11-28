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
 * frame socket, each with the stats it adds outright in manifest order (a
 * fusion's list Draw Time before its Charge Time). They give a crafted copy
 * its masterwork stats when its masterwork socket holds no stat plug. The plain
 * frame the socket starts with isn't one.
 */
function craftedFrames(
  item: DestinyInventoryItemDefinition,
  items: Record<number, DestinyInventoryItemDefinition>,
  plugSets: ManifestDefs["DestinyPlugSetDefinition"],
): { hash: number; stats: { statTypeHash: number; value: number }[] }[] {
  const recipe = items[item.inventory?.recipeItemHash ?? -1];
  return (recipe?.sockets?.socketEntries ?? []).flatMap((entry) =>
    collectSocketPlugCandidates(entry, plugSets).flatMap(({ hash }) => {
      const def = items[hash];
      if (hash === entry.singleInitialItemHash || def?.plug?.plugCategoryIdentifier !== INTRINSIC_PLUG_ID) return [];
      const stats = (def.investmentStats ?? []).filter((stat) => !stat.isConditionallyActive && stat.value > 0);
      return stats.length ? [{ hash, stats }] : [];
    }),
  );
}

/**
 * The one offered masterwork stat a frame counts under: the only one it adds,
 * or else the largest, the first listed on a tie (Draw Time over Charge Time on
 * a bow's, Shield Duration over it on a glaive's). Undefined when it adds none.
 */
export function frameMasterworkStat(
  stats: readonly { statTypeHash: number; value: number }[],
  offered: ReadonlySet<number>,
): number | undefined {
  let best: { statTypeHash: number; value: number } | undefined;
  for (const stat of stats) if (offered.has(stat.statTypeHash) && (!best || stat.value > best.value)) best = stat;
  return best?.statTypeHash;
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

    byStatHash.set(primaryMod.hash, {
      plugHash: hash,
      statHash: primaryMod.hash,
      statName,
      icon: def.displayProperties?.icon || undefined,
      statMods: statMods,
      ...(masterworkPlugHashes.length ? { masterworkPlugHashes } : {}),
    });
  }

  if (byStatHash.size === 0) return undefined;

  // Each enhanced frame under exactly one of the offered masterworks.
  const offered = new Set(byStatHash.keys());
  for (const frame of craftedFrames(item, items, plugSets)) {
    const stat = frameMasterworkStat(frame.stats, offered);
    const option = stat === undefined ? undefined : byStatHash.get(stat);
    if (!option || option.craftedFrameHashes?.includes(frame.hash)) continue;
    option.craftedFrameHashes = [...(option.craftedFrameHashes ?? []), frame.hash].sort((a, b) => a - b);
  }

  return [...byStatHash.values()].sort((a, b) => a.statName.localeCompare(b.statName));
}
