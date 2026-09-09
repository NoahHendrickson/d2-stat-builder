import type {
  DestinyItemComponent,
  DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import {
  SPIRIT_HASH_SET,
  SPIRIT_SOCKET_LEFT,
  SPIRIT_SOCKET_RIGHT,
  archetypeNameFromSpirit,
  isExoticClassItemHash,
} from "./exotic-class-perks";
import {
  ARMOR_ARCHETYPE_PLUG_CATEGORY,
  ARMOR_BUCKETS,
  ARTIFICE_MOD_CATEGORY,
  ARTIFICE_PERK_HASH,
  MASTERWORK_OFF_STAT_BONUS,
  STAT_HASHES,
  STAT_HASH_TO_INDEX,
  STAT_ORDER,
  TUNING_PLUG_CATEGORY,
  offArchetypeIndices,
  plugKindForCategory,
  type ArmorSlot,
  type ArmorSocketKind,
  type StatArray,
} from "./stats";

export type { ArmorSocketKind } from "./stats";

// Plug categories whose stat contributions are stripped to recover the base roll.
// NOTE: masterwork is deliberately NOT here — on Armor 3.0 its manifest bonus (+5 to all
// six) doesn't match the game (archetype stats are fixed/capped), so subtracting it
// corrupts the archetype. Masterwork is instead re-applied as an assumption in
// applyMasterwork(). LEGACY pieces have no archetype caps — their +2-all-six masterwork
// plug contributes at face value, so for them it IS stripped (LEGACY_PLUG_PATTERNS) and
// re-applied as an assumption in applyLegacyMasterwork().
const CHANGEABLE_PLUG_PATTERNS = ["enhancements", "tuning"];
const LEGACY_PLUG_PATTERNS = [...CHANGEABLE_PLUG_PATTERNS, "masterworks"];

/** Fully-masterworked legacy (Armor 2.0) armor: +2 to all six stats (the
 * v460.plugs.armor.masterworks.stat plugs list exactly this). */
const LEGACY_MASTERWORK_BONUS = 2;

export type ArmorLocation = "equipped" | "inventory" | "vault";

/** One writable mod socket on a piece, from its live sockets + definition. */
export interface ArmorSocket {
  index: number;
  /** general = stat mod; other = slot-specific / activity; tuning; artifice. */
  kind: ArmorSocketKind;
  /** The current plug's category identifier (what this socket is for). */
  category: string;
  /** Currently socketed plug. */
  plugHash?: number;
  /** DestinyPlugSetDefinition listing the mods that fit here, from the item definition. */
  plugSetHash?: number;
  /** The socket's "Empty … Socket" plug (its definition's initial item) — not a pickable mod. */
  emptyPlugHash?: number;
}

export interface ArmorPiece {
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  /** Season / featured badge overlaid on `icon` (Bungie watermark PNG). */
  watermark?: string;
  slot: ArmorSlot;
  classType: number;
  isExotic: boolean;
  /** Artifice armor — has a free +3 stat mod slot (common on Armor 2.0 pieces + exotics). */
  isArtifice: boolean;
  setHash?: number;
  /** Archetype plug name (e.g. "Gunner") — Armor 3.0 only; undefined on legacy pieces. */
  archetype?: string;
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
  /**
   * Exotic class item Spirit pair [left, right] from sockets 10/11, when both are
   * known Spirit plugs. Used to filter theoretical perk selections against owned rolls.
   */
  exoticPerkHashes?: [number, number];
  location: ArmorLocation;
  characterId?: string;
  /** Every writable mod socket (for the mod picker + applying loadouts). */
  armorSockets?: ArmorSocket[];
  /** Armor energy (component 300) — capacity and what current plugs use. */
  energy?: { capacity: number; used: number };
}

const ITEM_TYPE_ARMOR = 2;
const TIER_TYPE_EXOTIC = 6;

/**
 * Base roll = the instance's current stats (component 304) minus the stat
 * contributions of mods / tuning (3.0 masterwork is left in — see applyMasterwork;
 * legacy masterwork IS stripped when `legacy` is set — see LEGACY_PLUG_PATTERNS).
 * Works for legendaries AND exotics — exotics expose no intrinsic stat plugs, so
 * their stats only appear in component 304.
 */
export function computeBaseStats(
  instanceId: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
  legacy = false,
): StatArray {
  const base = readCurrentStats(instanceId, profile);
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return base;

  const patterns = legacy ? LEGACY_PLUG_PATTERNS : CHANGEABLE_PLUG_PATTERNS;
  for (const socket of sockets) {
    const plugHash = socket.plugHash;
    if (!plugHash) continue;
    const plug = manifest.def("DestinyInventoryItemDefinition", plugHash);
    const cat = plug?.plug?.plugCategoryIdentifier;
    if (!cat || !patterns.some((p) => cat.includes(p))) continue;
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

/** Assume MW5 (Armor 3.0): ensure the 3 off-archetype stats (the 3 lowest) are at least +5. */
function applyMasterwork(base: StatArray): StatArray {
  const out = base.slice() as StatArray;
  for (const i of offArchetypeIndices(base)) {
    out[i] = Math.max(out[i], MASTERWORK_OFF_STAT_BONUS);
  }
  return out;
}

/**
 * Assume full legacy (Armor 2.0) masterwork: +2 to all six stats. Legacy pieces have
 * no archetype caps, so the bonus applies flat — using the 3.0 raise-the-lowest model
 * here deflated the three high stats by 2 each (real-world case: legacy Verity's Brow
 * normalized to weapons 15 vs D2ArmorPicker's 17, under-reporting ceilings by 2).
 */
function applyLegacyMasterwork(base: StatArray): StatArray {
  return base.map((v) => v + LEGACY_MASTERWORK_BONUS) as StatArray;
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

/** The name of the piece's archetype plug (Armor 3.0), or undefined on legacy pieces. */
function archetypeName(
  instanceId: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
): string | undefined {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return undefined;
  for (const socket of sockets) {
    if (!socket.plugHash) continue;
    const plug = manifest.def("DestinyInventoryItemDefinition", socket.plugHash);
    const cat = plug?.plug?.plugCategoryIdentifier;
    if (cat?.includes(ARMOR_ARCHETYPE_PLUG_CATEGORY)) {
      return plug?.displayProperties?.name || undefined;
    }
  }
  return undefined;
}

/**
 * Spirit perk pair on an exotic class item (sockets 10 / 11). Prefers those indices;
 * falls back to scanning for any two Spirit plugs in socket order (D2AP-style).
 */
function exoticClassItemPerks(
  instanceId: string,
  profile: DestinyProfileResponse,
): [number, number] | undefined {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return undefined;

  const left = sockets[SPIRIT_SOCKET_LEFT]?.plugHash;
  const right = sockets[SPIRIT_SOCKET_RIGHT]?.plugHash;
  if (
    left &&
    right &&
    SPIRIT_HASH_SET.has(left) &&
    SPIRIT_HASH_SET.has(right)
  ) {
    return [left, right];
  }

  const found: number[] = [];
  for (const socket of sockets) {
    if (socket.plugHash && SPIRIT_HASH_SET.has(socket.plugHash)) {
      found.push(socket.plugHash);
      if (found.length === 2) return [found[0], found[1]];
    }
  }
  return undefined;
}

/**
 * A piece is artifice if it carries the artifice intrinsic perk (legendary artifice
 * armor) OR a usable enhancements.artifice mod socket (legacy exotics' empty/Forged
 * slot). The locked exotic payment socket (`enhancements.artifice.exotic`) does NOT
 * count — every exotic def still has it, including Armor 3.0 class items that lost
 * artifice entirely.
 */
function isArtificePiece(
  instanceId: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
): boolean {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return false;
  for (const socket of sockets) {
    if (!socket.plugHash) continue;
    if (socket.plugHash === ARTIFICE_PERK_HASH) return true;
    const cat = manifest.def("DestinyInventoryItemDefinition", socket.plugHash)?.plug
      ?.plugCategoryIdentifier;
    if (cat === ARTIFICE_MOD_CATEGORY) return true;
  }
  return false;
}

/**
 * Every writable mod socket, classified from the live sockets' current plugs (an empty
 * socket still holds an "Empty … Socket" plug of the right category): general stat
 * mod, tuning, artifice, and "other" (slot-specific / activity). Locked exotic
 * payment sockets (`enhancements.artifice.exotic`, `enhancements.exotic…`) are skipped.
 * The item definition supplies each socket's plug set (the mods that fit).
 */
function findArmorSockets(
  instanceId: string,
  def: {
    sockets?: {
      socketEntries?: {
        reusablePlugSetHash?: number;
        randomizedPlugSetHash?: number;
        singleInitialItemHash?: number;
      }[];
    };
  },
  profile: DestinyProfileResponse,
  manifest: Manifest,
): ArmorSocket[] | undefined {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return undefined;
  const out: ArmorSocket[] = [];
  sockets.forEach((socket, i) => {
    if (!socket.plugHash) return;
    const cat = manifest.def("DestinyInventoryItemDefinition", socket.plugHash)?.plug
      ?.plugCategoryIdentifier;
    if (!cat) return;
    const kind = plugKindForCategory(cat);
    if (!kind) return;
    const entry = def.sockets?.socketEntries?.[i];
    const plugSetHash = entry?.reusablePlugSetHash || entry?.randomizedPlugSetHash || undefined;
    const emptyPlugHash = entry?.singleInitialItemHash || undefined;
    out.push({
      index: i,
      kind,
      category: cat,
      plugHash: socket.plugHash,
      ...(plugSetHash ? { plugSetHash } : {}),
      ...(emptyPlugHash ? { emptyPlugHash } : {}),
    });
  });
  return out;
}

function readEnergy(
  instanceId: string,
  profile: DestinyProfileResponse,
): { capacity: number; used: number } | undefined {
  const energy = profile.itemComponents?.instances?.data?.[instanceId]?.energy;
  if (!energy) return undefined;
  return { capacity: energy.energyCapacity, used: energy.energyUsed };
}

/** True when a tuning-category plug is currently in any socket (empty or slotted). */
function hasTuningSocket(
  instanceId: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
): boolean {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets;
  if (!sockets) return false;
  for (const socket of sockets) {
    if (!socket.plugHash) continue;
    const cat = manifest.def("DestinyInventoryItemDefinition", socket.plugHash)?.plug
      ?.plugCategoryIdentifier;
    if (cat?.includes(TUNING_PLUG_CATEGORY)) return true;
  }
  return false;
}

/** Season or featured icon overlay. Featured wins; else the versioned quality watermark. */
export function itemWatermark(
  def:
    | {
        isFeaturedItem?: boolean;
        iconWatermarkFeatured?: string;
        iconWatermark?: string;
        quality?: { currentVersion?: number; displayVersionWatermarkIcons?: string[] };
      }
    | undefined,
  versionNumber?: number,
): string | undefined {
  if (!def) return undefined;
  if (def.isFeaturedItem) {
    const featured = def.iconWatermarkFeatured || undefined;
    if (featured) return featured;
  }
  const icons = def.quality?.displayVersionWatermarkIcons;
  if (icons?.length) {
    const i = versionNumber ?? def.quality?.currentVersion ?? 0;
    return icons[i] || icons[0] || undefined;
  }
  return def.iconWatermark || undefined;
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

  const isExotic = def.inventory?.tierType === TIER_TYPE_EXOTIC;
  const exoticClassItem = isExotic && isExoticClassItemHash(item.itemHash);
  const exoticPerkHashes = exoticClassItem
    ? exoticClassItemPerks(item.itemInstanceId, profile)
    : undefined;

  // Rolled tuned stat from component 310. Exotic class items (and other T5 exotics)
  // use a flexible tuning plug set — when 310 is missing but the empty tuning socket
  // is present, treat them as tunable with an arbitrary sentinel (optimizer ignores
  // the rolled value for exotics and allows any +5 direction).
  let tunedStat = computeTunedStat(item.itemInstanceId, profile, manifest);
  if (
    tunedStat === undefined &&
    exoticClassItem &&
    hasTuningSocket(item.itemInstanceId, profile, manifest)
  ) {
    tunedStat = 0;
  }

  let archetype = archetypeName(item.itemInstanceId, profile, manifest);
  // Exotic class items have no armor_archetypes plug — the left Spirit encodes the
  // 30/25 pair. Derive the display name so the table/inspector match other T5 gear.
  if (archetype === undefined && exoticPerkHashes) {
    archetype = archetypeNameFromSpirit(manifest, exoticPerkHashes[0]);
  }

  // No tuning socket AND no archetype plug → legacy (Armor 2.0). (Sub-Tier-5 Armor
  // 3.0 pieces lack the tuning socket but still carry an archetype.)
  const legacy = tunedStat === undefined && archetype === undefined;

  const baseStats = computeBaseStats(item.itemInstanceId, profile, manifest, legacy);

  // A tuning socket marks the piece as Tier-5 Armor 3.0 — the only system where the
  // def-level intrinsic bonus is active in-game.
  const stats = legacy ? applyLegacyMasterwork(baseStats) : applyMasterwork(baseStats);
  if (tunedStat !== undefined) {
    const bonus = intrinsicStats(def);
    for (let i = 0; i < stats.length; i++) stats[i] += bonus[i];
  }

  const armorSockets = findArmorSockets(item.itemInstanceId, def, profile, manifest);
  const energy = readEnergy(item.itemInstanceId, profile);
  const watermark = itemWatermark(def, item.versionNumber);

  return {
    instanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: def.displayProperties?.name ?? "Unknown",
    icon: def.displayProperties?.icon,
    slot,
    classType: def.classType ?? 3,
    isExotic,
    // Exotic class items lost artifice at Edge of Fate (tuning replaced it). Their
    // defs still carry a Locked Artifice Socket — never treat them as artifice.
    isArtifice: exoticClassItem
      ? false
      : isArtificePiece(item.itemInstanceId, profile, manifest),
    setHash: def.equippingBlock?.equipableItemSetHash || undefined,
    archetype,
    baseStats,
    stats,
    tunedStat,
    exoticPerkHashes,
    location,
    characterId,
    ...(watermark ? { watermark } : {}),
    ...(armorSockets ? { armorSockets } : {}),
    ...(energy ? { energy } : {}),
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
