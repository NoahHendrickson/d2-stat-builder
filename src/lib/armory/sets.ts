import type { Manifest } from "@/lib/manifest/load";
import { memoByManifest } from "../manifest/memo";
import { legacyRaidOfDef, type LegacyRaidKey } from "./legacy-raids";
import { itemWatermark, type ArmorPiece } from "./normalize";
import { ARMOR_BUCKETS, TIER_LEGENDARY, type ArmorSlot } from "./stats";

export interface SetPerkInfo {
  requiredCount: number;
  name: string;
  description?: string;
}

export interface ArmorSetInfo {
  setHash: number;
  name: string;
  perks: SetPerkInfo[];
  /** How many pieces of this set the player owns (within the given list). */
  ownedCount: number;
}

/** Owned pieces per set hash. */
function countBySet(pieces: ArmorPiece[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const p of pieces) {
    if (p.setHash) counts.set(p.setHash, (counts.get(p.setHash) ?? 0) + 1);
  }
  return counts;
}

/** Resolve the distinct armor sets present in `pieces` to names + 2pc/4pc perks. */
export function availableSets(
  pieces: ArmorPiece[],
  manifest: Manifest,
): ArmorSetInfo[] {
  const counts = countBySet(pieces);

  const sets: ArmorSetInfo[] = [];
  for (const [setHash, ownedCount] of counts) {
    const info = setInfo(manifest, setHash, ownedCount);
    if (info) sets.push(info);
  }

  return sets.sort((a, b) => b.ownedCount - a.ownedCount);
}

/**
 * Every armor set this class can wear, owned or not, with how many of its pieces are in
 * `pieces` — for planning which set to farm. A set counts when it has set bonuses and
 * the manifest lists a piece of it for the class.
 */
export function classSets(
  manifest: Manifest,
  classType: number,
  pieces: ArmorPiece[],
): ArmorSetInfo[] {
  const counts = countBySet(pieces);
  const sets: ArmorSetInfo[] = [];
  const table = manifest.all("DestinyEquipableItemSetDefinition");
  for (const key in table) {
    const def = table[key];
    if (!def.setPerks?.length) continue;
    const wearable = (def.setItems ?? []).some((itemHash) => {
      const item = manifest.def("DestinyInventoryItemDefinition", itemHash);
      return (
        item?.classType === classType &&
        (item.inventory?.bucketTypeHash as number) in ARMOR_BUCKETS
      );
    });
    if (!wearable) continue;
    const setHash = Number(key);
    const info = setInfo(manifest, setHash, counts.get(setHash) ?? 0);
    if (info) sets.push(info);
  }
  return sets.sort((a, b) => b.ownedCount - a.ownedCount || a.name.localeCompare(b.name));
}

/** A set's name and 2pc / 4pc perks, or null when the manifest doesn't have it. */
function setInfo(manifest: Manifest, setHash: number, ownedCount: number): ArmorSetInfo | null {
  const def = manifest.def("DestinyEquipableItemSetDefinition", setHash);
  if (!def) return null;
  const perks: SetPerkInfo[] = (def.setPerks ?? [])
    .map((sp) => {
      const perk = manifest.def("DestinySandboxPerkDefinition", sp.sandboxPerkHash);
      return {
        requiredCount: sp.requiredSetCount,
        name: perk?.displayProperties?.name ?? `${sp.requiredSetCount}-piece bonus`,
        description: perk?.displayProperties?.description || undefined,
      };
    })
    .sort((a, b) => a.requiredCount - b.requiredCount);
  return {
    setHash,
    name: def.displayProperties?.name ?? "Unknown set",
    perks,
    ownedCount,
  };
}

/**
 * Set requirements narrowed to the bonuses the owned pieces can make: a requirement for a
 * set with fewer owned pieces than it needs drops to the 2pc when 2+ are owned, or goes.
 * Returns `reqs` itself when nothing changes.
 */
export function makeableSetReqs(
  reqs: Record<number, 2 | 4>,
  sets: ReadonlyMap<number, Pick<ArmorSetInfo, "ownedCount">>,
): Record<number, 2 | 4> {
  let changed = false;
  const kept: Record<number, 2 | 4> = {};
  for (const [h, count] of Object.entries(reqs)) {
    const owned = sets.get(Number(h))?.ownedCount ?? 0;
    const made: 2 | 4 | null = owned >= count ? count : owned >= 2 ? 2 : null;
    if (made !== count) changed = true;
    if (made) kept[Number(h)] = made;
  }
  return changed ? kept : reqs;
}

/** A set piece's look for one slot: its icon and season watermark. */
export interface SetSlotIcon {
  icon: string;
  watermark?: string;
}

/**
 * The set's own item icon per slot for one class, from the set definition's item list
 * (every class's pieces are listed; the first match per slot wins). Slots the manifest
 * has no iconned piece for are absent.
 */
export function setSlotIcons(
  manifest: Manifest,
  setHash: number,
  classType: number,
): Partial<Record<ArmorSlot, SetSlotIcon>> {
  const out: Partial<Record<ArmorSlot, SetSlotIcon>> = {};
  const set = manifest.def("DestinyEquipableItemSetDefinition", setHash);
  for (const itemHash of set?.setItems ?? []) {
    const def = manifest.def("DestinyInventoryItemDefinition", itemHash);
    if (!def || def.classType !== classType) continue;
    const slot =
      ARMOR_BUCKETS[def.inventory?.bucketTypeHash as keyof typeof ARMOR_BUCKETS];
    const icon = def.displayProperties?.icon;
    if (!slot || !icon || out[slot]) continue;
    out[slot] = { icon, watermark: itemWatermark(def) };
  }
  return out;
}

/** setIcon's answers, per manifest, by "<set>:<class>". */
const setIcons = memoByManifest(() => new Map<string, SetSlotIcon | undefined>());

/**
 * One thumbnail for a set: `classType`'s helmet, else another of its pieces,
 * else another class's (helmet first), so a set always has a face whoever is
 * looking. `null` takes any class. Worked out once per set and class.
 */
export function setIcon(manifest: Manifest, setHash: number, classType: number | null): SetSlotIcon | undefined {
  const cache = setIcons(manifest);
  const key = `${setHash}:${classType}`;
  if (cache.has(key)) return cache.get(key);
  let best: { look: SetSlotIcon; rank: number } | undefined;
  const set = manifest.def("DestinyEquipableItemSetDefinition", setHash);
  for (const itemHash of set?.setItems ?? []) {
    const def = manifest.def("DestinyInventoryItemDefinition", itemHash);
    const slot = ARMOR_BUCKETS[def?.inventory?.bucketTypeHash as keyof typeof ARMOR_BUCKETS];
    const icon = def?.displayProperties?.icon;
    if (!def || !slot || !icon) continue;
    // Lower is better: the class's own piece first, a helmet first within each.
    const rank = (classType === null || def.classType === classType ? 0 : 2) + (slot === "helmet" ? 0 : 1);
    if (!best || rank < best.rank) best = { look: { icon, watermark: itemWatermark(def) }, rank };
    if (rank === 0) break;
  }
  cache.set(key, best?.look);
  return best?.look;
}

/**
 * Each legacy raid's own item icon per slot for one class, from the manifest's legendary
 * armor with that raid's mod socket (the first match per slot wins). For drawing the
 * slots a player owns no piece in. One pass over the item table per class, kept for the
 * session (raidSlotIconCache).
 */
export function legacyRaidSlotIcons(
  manifest: Manifest,
  classType: number,
): RaidSlotIcons {
  const cache = raidSlotIconCache(manifest);
  let out = cache.get(classType);
  if (!out) {
    out = scanRaidSlotIcons(manifest, classType);
    cache.set(classType, out);
  }
  return out;
}

type RaidSlotIcons = Map<LegacyRaidKey, Partial<Record<ArmorSlot, SetSlotIcon>>>;

const raidSlotIconCache = memoByManifest(() => new Map<number, RaidSlotIcons>());

function scanRaidSlotIcons(manifest: Manifest, classType: number): RaidSlotIcons {
  const out: RaidSlotIcons = new Map();
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.classType !== classType || def.inventory?.tierType !== TIER_LEGENDARY) continue;
    const slot = ARMOR_BUCKETS[def.inventory.bucketTypeHash as keyof typeof ARMOR_BUCKETS];
    const icon = def.displayProperties?.icon;
    // Armor 2.0 only, like the pieces themselves (see buildPiece).
    if (!slot || !icon || def.redacted || def.equippingBlock?.equipableItemSetHash) continue;
    const raid = legacyRaidOfDef(def, manifest);
    if (!raid) continue;
    const looks = out.get(raid) ?? {};
    looks[slot] ??= { icon, watermark: itemWatermark(def) };
    out.set(raid, looks);
  }
  return out;
}
