import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { StatMod } from "./types";

type SocketPlugSetEntry = { plugItemHash: number; currentlyCanRoll?: boolean };

/** Plug definition subset needed to read a randomized pool's layout. */
type PoolPlugDefs = Record<
  number,
  Pick<DestinyInventoryItemDefinition, "displayProperties" | "inventory" | "plug"> | undefined
>;

/** Socket entry subset needed for rollability heuristics. */
export interface SocketPlugSource {
  randomizedPlugSetHash?: number;
  reusablePlugSetHash?: number;
  singleInitialItemHash?: number;
}

/**
 * Whether a manifest plug-set entry should be treated as currently rollable.
 *
 * `currentlyCanRoll` carries no signal for randomized weapon pools: every entry in
 * every one is `true` (older manifests had them all `false`). Membership is the
 * baseline signal, narrowed by `pairedPoolPlugs` when plug definitions are
 * available. The flag is only meaningful for reusable-only pools (fixed/curated options).
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

/**
 * The plugs that can actually roll from a randomized barrel/magazine-style pool.
 *
 * Bungie lays pools out as `[base perks][their enhanced versions][later additions]`.
 * Base perks without a partner in that first enhanced run (Sticky Grenades on heavy
 * GLs) and everything after it (Full Choke on hand cannon barrels) are listed but
 * never drop. Trait pools are left alone: their later blocks do roll. Returns
 * undefined when the rule doesn't apply. destiny.report filters the same way.
 */
export function pairedPoolPlugs(
  plugItemHashes: number[],
  items: PoolPlugDefs,
): Set<number> | undefined {
  const isEnhanced = (hash: number) => items[hash]?.inventory?.tierType === 3;
  // "Golden Tricorn Enhanced" pairs with "Golden Tricorn".
  const name = (hash: number) =>
    (items[hash]?.displayProperties?.name ?? "").replace(/ Enhanced$/, "");
  const isEmpty = (hash: number) =>
    Boolean(items[hash]?.plug?.plugCategoryIdentifier?.includes("empty")) ||
    /^Empty .* Socket$/.test(items[hash]?.displayProperties?.name ?? "");

  const plugs = plugItemHashes.filter((hash) => !isEmpty(hash));
  if (plugs.some((hash) => items[hash]?.plug?.plugCategoryIdentifier === "frames")) return undefined;

  let i = 0;
  const base: number[] = [];
  while (i < plugs.length && !isEnhanced(plugs[i]!)) base.push(plugs[i++]!);
  const enhanced: number[] = [];
  while (i < plugs.length && isEnhanced(plugs[i]!)) enhanced.push(plugs[i++]!);
  if (enhanced.length === 0) return undefined;

  const enhancedNames = new Set(enhanced.map(name));
  return new Set([...base.filter((hash) => enhancedNames.has(name(hash))), ...enhanced]);
}

/**
 * Collect deduped plug candidates for one socket, OR-merging rollability per hash.
 * Pass `items` to drop never-rolling entries from randomized pools (see `pairedPoolPlugs`).
 */
export function collectSocketPlugCandidates(
  socketEntry: SocketPlugSource,
  plugSets: Record<number, { reusablePlugItems?: SocketPlugSetEntry[] }>,
  items?: PoolPlugDefs,
): { hash: number; canRoll: boolean }[] {
  const byHash = new Map<number, boolean>();
  const plugSetHash = socketEntry.randomizedPlugSetHash ?? socketEntry.reusablePlugSetHash;
  const pool = plugSetHash != null ? (plugSets[plugSetHash]?.reusablePlugItems ?? []) : [];
  const poolHashes = pool.map((plug) => plug.plugItemHash);
  const paired =
    items && plugSetHash === socketEntry.randomizedPlugSetHash
      ? pairedPoolPlugs(poolHashes, items)
      : undefined;
  const rulesOut = (hash: number) => paired != null && !paired.has(hash) && poolHashes.includes(hash);

  if (plugSetHash != null) {
    for (const plug of pool) {
      if (rulesOut(plug.plugItemHash)) continue;
      const canRoll = plugSetEntryCanRoll(socketEntry, plugSetHash, plug);
      const existing = byHash.get(plug.plugItemHash);
      byHash.set(plug.plugItemHash, existing == null ? canRoll : existing || canRoll);
    }
  }
  if (socketEntry.singleInitialItemHash) {
    // Fixed socket plug (e.g. origin trait). Older raid weapons also list a crafting
    // empty-socket plug set on the same socket — merge this in regardless. A curated
    // default the paired pool rules out stays out: VS Chill Inhibitor ships with
    // Sticky Grenades, but no random roll can have it.
    if (!rulesOut(socketEntry.singleInitialItemHash)) {
      byHash.set(socketEntry.singleInitialItemHash, true);
    }
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
