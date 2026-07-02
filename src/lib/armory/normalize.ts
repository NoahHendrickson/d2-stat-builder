import type {
  DestinyItemComponent,
  DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import {
  ARMOR_BUCKETS,
  ARTIFICE_PERK_HASH,
  MASTERWORK_OFF_STAT_BONUS,
  STAT_HASHES,
  STAT_HASH_TO_INDEX,
  STAT_ORDER,
  TUNING_PLUG_CATEGORY,
  offArchetypeIndices,
  type ArmorSlot,
  type StatArray,
} from "./stats";

// Plug categories whose stat contributions are stripped to recover the base roll.
// NOTE: masterwork is deliberately NOT here — its manifest bonus (+5 to all six) doesn't
// match the game (archetype stats are fixed/capped), so subtracting it corrupts the archetype.
// Masterwork is instead re-applied as an assumption in applyMasterwork().
const CHANGEABLE_PLUG_PATTERNS = ["enhancements", "tuning"];

export type ArmorLocation = "equipped" | "inventory" | "vault";

export interface ArmorPiece {
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  slot: ArmorSlot;
  classType: number;
  isExotic: boolean;
  /** Artifice armor — has a free +3 stat mod slot (common on Armor 2.0 pieces + exotics). */
  isArtifice: boolean;
  setHash?: number;
  /** True base roll: intrinsic stat plugs only — no mods, masterwork, or tuning. */
  baseStats: StatArray;
  /**
   * Base roll + assumed MW5 (+5 to the 3 off-archetype stats) + the def-level exotic
   * intrinsic bonus on Armor 3.0 pieces. What the optimizer consumes.
   */
  stats: StatArray;
  /**
   * Tier-5 tuning: index (0–5) of this instance's rolled tuned stat (the stat its
   * directional tuning plugs add +5 to), or undefined if the piece can't be tuned.
   */
  tunedStat?: number;
  location: ArmorLocation;
  characterId?: string;
}

const ITEM_TYPE_ARMOR = 2;
const TIER_TYPE_EXOTIC = 6;

/**
 * Base roll = the instance's current stats (component 304) minus the stat
 * contributions of mods / tuning (masterwork is left in — see applyMasterwork).
 * Works for legendaries AND exotics — exotics expose no intrinsic stat plugs, so
 * their stats only appear in component 304.
 */
export function computeBaseStats(
  instanceId: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
): StatArray {
  const base = readCurrentStats(instanceId, profile);
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return base;

  for (const socket of sockets) {
    const plugHash = socket.plugHash;
    if (!plugHash) continue;
    const plug = manifest.def("DestinyInventoryItemDefinition", plugHash);
    const cat = plug?.plug?.plugCategoryIdentifier;
    if (!cat || !CHANGEABLE_PLUG_PATTERNS.some((p) => cat.includes(p))) continue;
    const inv = plug.investmentStats ?? [];
    // Balanced Tuning's manifest entry lists +1 to ALL SIX stats, but in-game the archetype
    // stats are capped (like masterwork) so only the 3 off-archetype stats actually moved.
    // Subtracting the manifest's archetype +1 would drop the archetype below its real value,
    // so for an all-positive tuning plug we strip only the off-archetype contributions.
    const offOnly =
      cat.includes(TUNING_PLUG_CATEGORY) && !inv.some((s) => s.value < 0);
    const offArch = offOnly ? offArchetypeIndices(base) : null;
    for (const s of inv) {
      const idx = STAT_HASH_TO_INDEX[s.statTypeHash];
      if (idx === undefined) continue;
      if (offArch && !offArch.includes(idx)) continue; // leave capped archetype stats alone
      base[idx] -= s.value;
    }
  }
  for (let i = 0; i < base.length; i++) if (base[i] < 0) base[i] = 0;
  return base;
}

/** Fallback: the piece's current instanced stats (component 304) — includes whatever is slotted. */
function readCurrentStats(
  instanceId: string,
  profile: DestinyProfileResponse,
): StatArray {
  const out: StatArray = [0, 0, 0, 0, 0, 0];
  const stats = profile.itemComponents?.stats?.data?.[instanceId]?.stats;
  if (!stats) return out;
  STAT_ORDER.forEach((key, i) => {
    out[i] = stats[STAT_HASHES[key]]?.value ?? 0;
  });
  return out;
}

/** Assume MW5: ensure the 3 off-archetype stats (the 3 lowest) are at least +5. */
function applyMasterwork(base: StatArray): StatArray {
  const out = base.slice() as StatArray;
  for (const i of offArchetypeIndices(base)) {
    out[i] = Math.max(out[i], MASTERWORK_OFF_STAT_BONUS);
  }
  return out;
}

/**
 * The instance's rolled tuned stat, read from its tuning socket's available plugs
 * (component 310). Every directional tuning plug adds +5 to one shared stat (the
 * tuned stat) and −5 to another; we return that +5 stat's index. Balanced Tuning
 * (all-positive) is skipped. Undefined when the piece has no tuning socket (not Tier 5).
 */
/**
 * The instance's rolled tuned stat — the stat its directional tuning adds +5 to — read
 * from the tuning socket's available plugs (component 310). Returns the first directional's
 * +5 stat index, or undefined when there's no tuning socket (not Tier 5).
 *
 * NOTE for exotics: a Tier-5 exotic's tuning socket is *flexible* — it exposes a directional
 * for EVERY stat, so this "first" value is arbitrary and the optimizer must not lock an
 * exotic to it. `OptimizerPiece.exotic` signals the optimizer to allow any +5 direction.
 */
function computeTunedStat(
  instanceId: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
): number | undefined {
  const reusable =
    profile.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs;
  if (!reusable) return undefined;

  for (const plugs of Object.values(reusable)) {
    for (const plug of plugs) {
      const def = manifest.def("DestinyInventoryItemDefinition", plug.plugItemHash);
      const cat = def?.plug?.plugCategoryIdentifier;
      if (!cat || !cat.includes(TUNING_PLUG_CATEGORY)) continue;
      const inv = def.investmentStats ?? [];
      const plus = inv.find((s) => s.value > 0);
      const minus = inv.find((s) => s.value < 0);
      if (plus && minus) {
        const idx = STAT_HASH_TO_INDEX[plus.statTypeHash];
        if (idx !== undefined) return idx;
      }
    }
  }
  return undefined;
}

/**
 * Armor 3.0 exotics carry an intrinsic stat bonus on the item DEFINITION's
 * investmentStats (e.g. Sanguine Alchemy: +10 health, +10 class) — it appears in
 * neither the live stats component (304) nor any socket plug, so it must be added
 * on top of the rolled stats. Armor 3.0 legendaries list no def-level stats, and
 * conditionally-active entries don't apply passively, so both contribute 0. The
 * bonus is NOT part of the base roll: archetype / off-archetype classification
 * (masterwork + Balanced Tuning targets) must come from the roll alone.
 */
function intrinsicStats(
  def: { investmentStats?: { statTypeHash: number; value: number; isConditionallyActive?: boolean }[] },
): StatArray {
  const out: StatArray = [0, 0, 0, 0, 0, 0];
  for (const s of def.investmentStats ?? []) {
    const idx = STAT_HASH_TO_INDEX[s.statTypeHash];
    if (idx !== undefined && !s.isConditionallyActive) out[idx] += s.value;
  }
  return out;
}

/** A piece is artifice if it carries the artifice intrinsic perk. */
function isArtificePiece(
  instanceId: string,
  profile: DestinyProfileResponse,
): boolean {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  return sockets?.some((s) => s.plugHash === ARTIFICE_PERK_HASH) ?? false;
}

function buildPiece(
  item: DestinyItemComponent,
  manifest: Manifest,
  profile: DestinyProfileResponse,
  location: ArmorLocation,
  characterId: string | undefined,
): ArmorPiece | null {
  if (!item.itemInstanceId) return null;

  const def = manifest.def("DestinyInventoryItemDefinition", item.itemHash);
  if (!def || def.itemType !== ITEM_TYPE_ARMOR) return null;

  // Slot comes from the definition's bucket, not the live one (vault items report the vault bucket).
  const slot =
    ARMOR_BUCKETS[def.inventory?.bucketTypeHash as keyof typeof ARMOR_BUCKETS];
  if (!slot) return null;

  const baseStats = computeBaseStats(item.itemInstanceId, profile, manifest);
  const tunedStat = computeTunedStat(item.itemInstanceId, profile, manifest);

  // A tuning socket marks the piece as Armor 3.0 — the only system where the
  // def-level intrinsic bonus is active in-game.
  const stats = applyMasterwork(baseStats);
  if (tunedStat !== undefined) {
    const bonus = intrinsicStats(def);
    for (let i = 0; i < stats.length; i++) stats[i] += bonus[i];
  }

  return {
    instanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: def.displayProperties?.name ?? "Unknown",
    icon: def.displayProperties?.icon,
    slot,
    classType: def.classType ?? 3,
    isExotic: def.inventory?.tierType === TIER_TYPE_EXOTIC,
    isArtifice: isArtificePiece(item.itemInstanceId, profile),
    setHash: def.equippingBlock?.equipableItemSetHash || undefined,
    baseStats,
    stats,
    tunedStat,
    location,
    characterId,
  };
}

/** Turn a GetProfile response into a flat list of armor pieces (equipped + inventory + vault). */
export function normalizeArmory(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): ArmorPiece[] {
  const pieces: ArmorPiece[] = [];

  const collect = (
    items: DestinyItemComponent[] | undefined,
    location: ArmorLocation,
    characterId?: string,
  ) => {
    for (const item of items ?? []) {
      const piece = buildPiece(item, manifest, profile, location, characterId);
      if (piece) pieces.push(piece);
    }
  };

  for (const [charId, comp] of Object.entries(
    profile.characterEquipment?.data ?? {},
  )) {
    collect(comp.items, "equipped", charId);
  }
  for (const [charId, comp] of Object.entries(
    profile.characterInventories?.data ?? {},
  )) {
    collect(comp.items, "inventory", charId);
  }
  collect(profile.profileInventory?.data?.items, "vault");

  return pieces;
}
