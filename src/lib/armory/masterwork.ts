// Armor masterwork level + what it costs to finish it. Display-only: the optimizer
// keeps assuming every piece is fully masterworked (see applyMasterwork in
// normalize.ts); this just tells the player which pieces aren't there yet and what
// the game will charge to get them there.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { ItemDef } from "../manifest/item-def";
import type { Manifest } from "../manifest/load";
import { memoByManifest } from "../manifest/memo";
import { STAT_HASH_TO_INDEX } from "./stats";

/**
 * Armor 3.0 masterwork socket. Its plug encodes the level: +N to all six stats for
 * level N (the game caps archetype stats, which is why normalize never subtracts it).
 */
export const ARMOR_MASTERWORK_PLUG_CATEGORY = "v460.plugs.armor.masterworks";

/** Armor 3.0 tops out at level 5; legacy (Armor 2.0) at energy 10. */
export const ARMOR3_MAX_LEVEL = 5;
export const LEGACY_MAX_ENERGY = 10;

export const GLIMMER_HASH = 3159615086;
export const ENHANCEMENT_CORE_HASH = 3853748946;
export const ENHANCEMENT_PRISM_HASH = 4257549984;
export const ASCENDANT_SHARD_HASH = 4257549985;

/** Fallback names when the manifest has no definition for a material. */
export const MATERIAL_LABELS: Record<number, string> = {
  [GLIMMER_HASH]: "Glimmer",
  [ENHANCEMENT_CORE_HASH]: "Enhancement Core",
  [ENHANCEMENT_PRISM_HASH]: "Enhancement Prism",
  [ASCENDANT_SHARD_HASH]: "Ascendant Shard",
};

/** Display order: cheapest material first, rarest last; unknown materials trail. */
const MATERIAL_ORDER: readonly number[] = [
  GLIMMER_HASH,
  ENHANCEMENT_CORE_HASH,
  ENHANCEMENT_PRISM_HASH,
  ASCENDANT_SHARD_HASH,
];

/**
 * Rough scarcity weights, in Enhancement-Core equivalents, for ranking builds by
 * how expensive they are to finish. Prisms and shards trade at roughly 10:1 and
 * 100:1 against cores; glimmer is abundant (a full Tier-5 ladder is ~35k, a few
 * cores' worth here) so it mostly breaks ties.
 */
const MATERIAL_WEIGHTS: Record<number, number> = {
  [GLIMMER_HASH]: 1 / 10000,
  [ENHANCEMENT_CORE_HASH]: 1,
  [ENHANCEMENT_PRISM_HASH]: 10,
  [ASCENDANT_SHARD_HASH]: 100,
};

export interface MaterialStack {
  itemHash: number;
  count: number;
}

export interface MasterworkInfo {
  /** Current level: 0–5 on Armor 3.0, energy capacity 1–10 on legacy armor. */
  level: number;
  max: number;
  /**
   * Materials to reach `max`, summed over every remaining level. Empty when the
   * piece is already there. Undefined when the game exposes no upgrade path for
   * it (legacy armor below energy 10, or a profile without component 310).
   */
  cost?: MaterialStack[];
}

/** True when the piece reported a masterwork and has no levels left to buy. */
export function isFullyMasterworked(
  piece: { masterwork?: MasterworkInfo } | undefined,
): boolean {
  const mw = piece?.masterwork;
  return mw != null && mw.level >= mw.max;
}

/** The masterwork level a v460 plug grants: its +N to the six stats (0 for the empty plug). */
export function masterworkPlugLevel(
  def: Pick<ItemDef, "investmentStats"> | undefined,
): number {
  let level = 0;
  for (const s of def?.investmentStats ?? []) {
    if (STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined && s.value > level)
      level = s.value;
  }
  return level;
}

function orderIndex(hash: number): number {
  const i = MATERIAL_ORDER.indexOf(hash);
  return i === -1 ? MATERIAL_ORDER.length : i;
}

/** Merge stacks by material, dropping empties, in display order. */
export function sumMaterialStacks(
  stacks: Iterable<readonly MaterialStack[]>,
): MaterialStack[] {
  const totals = new Map<number, number>();
  for (const list of stacks) {
    for (const { itemHash, count } of list) {
      if (count <= 0) continue;
      totals.set(itemHash, (totals.get(itemHash) ?? 0) + count);
    }
  }
  return [...totals]
    .map(([itemHash, count]) => ({ itemHash, count }))
    .sort((a, b) => orderIndex(a.itemHash) - orderIndex(b.itemHash) || a.itemHash - b.itemHash);
}

/** Scarcity-weighted scalar for sorting (see MATERIAL_WEIGHTS). */
export function materialScore(stacks: readonly MaterialStack[] | undefined): number {
  let score = 0;
  for (const { itemHash, count } of stacks ?? []) {
    score += count * (MATERIAL_WEIGHTS[itemHash] ?? 1);
  }
  return score;
}

const socketIndexByDef = new WeakMap<object, number>();

/**
 * Ladders, material costs and plug levels are all manifest-derived, so they hang off
 * the manifest instance. Keyed on hashes alone they would outlive the manifest they
 * were read from, and a refreshed manifest (a Bungie hotfix re-pricing a rung) would
 * keep serving the previous season's answers for the rest of the session.
 */
const cachesFor = memoByManifest(() => ({
  ladders: new Map<string, number[] | undefined>(),
  materials: new Map<number, MaterialStack[]>(),
  plugLevels: new Map<number, number>(),
}));

/** `masterworkPlugLevel` by plug hash — the same few plugs are read once per piece. */
function plugLevelOf(plugHash: number, manifest: Manifest): number {
  const { plugLevels } = cachesFor(manifest);
  const cached = plugLevels.get(plugHash);
  if (cached !== undefined) return cached;
  const level = masterworkPlugLevel(
    manifest.def("DestinyInventoryItemDefinition", plugHash),
  );
  plugLevels.set(plugHash, level);
  return level;
}

function masterworkSocketIndex(
  def: Pick<ItemDef, "sockets">,
  sockets: readonly { plugHash?: number }[],
  manifest: Manifest,
): number {
  const cached = socketIndexByDef.get(def);
  if (cached !== undefined) {
    const plugHash = sockets[cached]?.plugHash;
    if (plugHash) {
      const plug = manifest.def("DestinyInventoryItemDefinition", plugHash);
      if (plug?.plug?.plugCategoryIdentifier === ARMOR_MASTERWORK_PLUG_CATEGORY) {
        return cached;
      }
    }
  }
  for (let i = 0; i < sockets.length; i++) {
    const plugHash = sockets[i].plugHash;
    if (!plugHash) continue;
    const plug = manifest.def("DestinyInventoryItemDefinition", plugHash);
    if (plug?.plug?.plugCategoryIdentifier !== ARMOR_MASTERWORK_PLUG_CATEGORY) continue;
    socketIndexByDef.set(def, i);
    return i;
  }
  return -1;
}

function plugMaterials(plugHash: number, manifest: Manifest): MaterialStack[] {
  const materialsByPlug = cachesFor(manifest).materials;
  const cached = materialsByPlug.get(plugHash);
  if (cached) return cached;
  const plug = manifest.def("DestinyInventoryItemDefinition", plugHash);
  const set = manifest.def(
    "DestinyMaterialRequirementSetDefinition",
    plug?.plug?.insertionMaterialRequirementHash,
  );
  const stacks = (set?.materials ?? [])
    .filter((m) => !m.omitFromRequirements)
    .map((m) => ({ itemHash: m.itemHash, count: m.count }));
  materialsByPlug.set(plugHash, stacks);
  return stacks;
}

/**
 * Read a piece's masterwork state from its live sockets.
 *
 * Armor 3.0: the socketed `v460.plugs.armor.masterworks` plug gives the level. The
 * remaining cost comes from the piece's tier-specific ladder — the socket's plug set
 * lists one 1→5 run per gear tier, back to back, and component 310 lists every
 * insertable plug. The remaining ladder is the entry whose level is `level + 1` and
 * every rung after it that climbs by exactly one. (The socketed level-0 plug is NOT a
 * reliable tier signal: many Tier-5 drops carry the Tier-4 empty plug.) Each rung's
 * DestinyMaterialRequirementSetDefinition is what the game charges for that single
 * step, so the ladder above the current level sums to the total.
 *
 * Legacy (Armor 2.0): no v460 socket; energy capacity is the level and the API
 * exposes no upgrade plugs, so the cost is unknown unless it's already 10.
 * `legacy` comes from the caller (normalize.ts decides it from the tuning and
 * archetype sockets) — energy capacity cannot tell the two apart, because every
 * Armor 3.0 masterwork plug below Tier 4 also reports a capacity of 10.
 */
export function readMasterwork(
  instanceId: string,
  def: Pick<ItemDef, "sockets">,
  profile: DestinyProfileResponse,
  manifest: Manifest,
  energy: { capacity: number } | undefined,
  legacy: boolean,
): MasterworkInfo | undefined {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return undefined;

  if (legacy) {
    if (!energy) return undefined;
    const capacity = energy.capacity;
    return {
      level: capacity,
      max: LEGACY_MAX_ENERGY,
      ...(capacity >= LEGACY_MAX_ENERGY ? { cost: [] } : {}),
    };
  }

  const socketIndex = masterworkSocketIndex(def, sockets, manifest);
  // Armor 3.0 whose masterwork socket the profile didn't report: unknown, not
  // finished. Guessing "done" here paints the gold frame on a level-0 piece and
  // tells the player it costs nothing to finish.
  if (socketIndex === -1) return undefined;

  const socketed = sockets[socketIndex]?.plugHash;
  const level = socketed ? plugLevelOf(socketed, manifest) : 0;

  if (level >= ARMOR3_MAX_LEVEL) return { level, max: ARMOR3_MAX_LEVEL, cost: [] };

  const plugs =
    profile.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs?.[socketIndex] ?? [];
  let next: number | undefined;
  for (const p of plugs) {
    if (plugLevelOf(p.plugItemHash, manifest) === level + 1) {
      next = p.plugItemHash;
      break;
    }
  }
  const ladder = next ? remainingLadder(def, socketIndex, next, level + 1, manifest) : undefined;
  if (!ladder?.length) return { level, max: ARMOR3_MAX_LEVEL };

  const cost = sumMaterialStacks(ladder.map((plugHash) => plugMaterials(plugHash, manifest)));
  return { level, max: ARMOR3_MAX_LEVEL, cost };
}

/**
 * The rungs from `next` (the plug at `expectedStart`) up to level 5, in order.
 * Undefined when the plug set can't be resolved, doesn't contain `next`, or the
 * climb doesn't start at `expectedStart`.
 */
function remainingLadder(
  def: Pick<ItemDef, "sockets">,
  socketIndex: number,
  next: number,
  expectedStart: number,
  manifest: Manifest,
): number[] | undefined {
  const entry = def.sockets?.socketEntries?.[socketIndex];
  const plugSetHash = entry?.reusablePlugSetHash || entry?.randomizedPlugSetHash;
  const ladderByKey = cachesFor(manifest).ladders;
  const cacheKey = `${plugSetHash ?? 0}:${next}:${expectedStart}`;
  if (ladderByKey.has(cacheKey)) return ladderByKey.get(cacheKey);

  const plugSet = manifest.def("DestinyPlugSetDefinition", plugSetHash);
  const items = plugSet?.reusablePlugItems;
  if (!items) {
    ladderByKey.set(cacheKey, undefined);
    return undefined;
  }
  const start = items.findIndex((p) => p.plugItemHash === next);
  if (start === -1) {
    ladderByKey.set(cacheKey, undefined);
    return undefined;
  }

  const ladder: number[] = [];
  let expected = expectedStart;
  for (let i = start; i < items.length; i++) {
    const hash = items[i].plugItemHash;
    if (plugLevelOf(hash, manifest) !== expected) break;
    ladder.push(hash);
    expected++;
  }
  const result = ladder.length > 0 ? ladder : undefined;
  ladderByKey.set(cacheKey, result);
  return result;
}

export interface LoadoutMasterworkSummary {
  /** Materials to fully masterwork every piece (only the ones with a known cost). */
  cost: MaterialStack[];
  /** Masterwork levels still to buy, across all pieces. */
  remainingLevels: number;
  /** Pieces below max whose cost the game doesn't expose. */
  unknownCostPieces: number;
  /** Pieces with no masterwork info at all (synthetic pins, missing sockets). */
  unknownPieces: number;
  /** True when every piece reported a masterwork and none have levels left to buy. */
  complete: boolean;
}

/** Roll five pieces' masterwork state up to one build-level summary. */
export function summarizeMasterwork(
  pieces: Iterable<{ masterwork?: MasterworkInfo } | undefined>,
): LoadoutMasterworkSummary {
  const costs: MaterialStack[][] = [];
  let remainingLevels = 0;
  let unknownCostPieces = 0;
  let unknownPieces = 0;
  let known = 0;
  for (const piece of pieces) {
    const mw = piece?.masterwork;
    if (!mw) {
      unknownPieces++;
      continue;
    }
    known++;
    const remaining = Math.max(0, mw.max - mw.level);
    remainingLevels += remaining;
    if (remaining === 0) continue;
    if (mw.cost) costs.push(mw.cost);
    else unknownCostPieces++;
  }
  return {
    cost: sumMaterialStacks(costs),
    remainingLevels,
    unknownCostPieces,
    unknownPieces,
    complete: unknownPieces === 0 && known > 0 && remainingLevels === 0,
  };
}
