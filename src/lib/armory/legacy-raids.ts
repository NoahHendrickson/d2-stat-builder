/**
 * Legacy raid armor: the Armor 2.0 raid sets from before Edge of Fate. They have no set
 * bonus. Each piece instead carries a raid mod socket, and that raid's mods only work
 * inside it. A piece is identified by the socket's plug category, which its "Empty Mod
 * Socket" and every mod that fits share (one category per raid, always socket 11 in the
 * live manifest). No more Armor 2.0 raid armor will ship, so the list is closed.
 *
 * Runtime imports are relative (not `@/`) so the module also runs under vitest.
 */
import type { SetRequirement } from "../optimizer/types";
import { ARMOR_SLOTS, type ArmorSlot } from "./stats";

/** Release order, which is also the order the builder lists them in. */
export const LEGACY_RAIDS = [
  { key: "garden", name: "Garden of Salvation", category: "enhancements.raid_garden" },
  { key: "dsc", name: "Deep Stone Crypt", category: "enhancements.raid_descent" },
  { key: "vog", name: "Vault of Glass", category: "enhancements.raid_v520" },
  { key: "vow", name: "Vow of the Disciple", category: "enhancements.raid_v600" },
  { key: "kf", name: "King's Fall", category: "enhancements.raid_v620" },
  { key: "ron", name: "Root of Nightmares", category: "enhancements.raid_v700" },
  { key: "crota", name: "Crota's End", category: "enhancements.raid_v720" },
  { key: "se", name: "Salvation's Edge", category: "enhancements.raid_v800" },
] as const;

export type LegacyRaidKey = (typeof LEGACY_RAIDS)[number]["key"];

/** Raid → how many of its pieces every build must wear (1–5). */
export type RaidReqs = Partial<Record<LegacyRaidKey, number>>;

/** The most pieces a requirement can ask for: every armor slot. */
export const MAX_RAID_PIECES = ARMOR_SLOTS.length;

const BY_CATEGORY = new Map<string, LegacyRaidKey>(
  LEGACY_RAIDS.map((r) => [r.category, r.key]),
);
const INDEX = new Map<string, number>(LEGACY_RAIDS.map((r, i) => [r.key, i]));

export function isLegacyRaidKey(v: unknown): v is LegacyRaidKey {
  return typeof v === "string" && INDEX.has(v);
}

export function legacyRaidName(key: LegacyRaidKey): string {
  return LEGACY_RAIDS[INDEX.get(key)!].name;
}

/** The raid whose mod socket an item definition has, if any. */
export function legacyRaidOf(
  def: { sockets?: { socketEntries?: { singleInitialItemHash?: number }[] } },
  plugCategory: (plugHash: number) => string | undefined,
): LegacyRaidKey | undefined {
  for (const entry of def.sockets?.socketEntries ?? []) {
    if (!entry.singleInitialItemHash) continue;
    const cat = plugCategory(entry.singleInitialItemHash);
    const key = cat ? BY_CATEGORY.get(cat) : undefined;
    if (key) return key;
  }
  return undefined;
}

/**
 * The optimizer's stand-in set hash for a raid. The solver only knows set requirements,
 * and "wear N pieces of this raid" is one. Negative, so it can't collide with a real
 * DestinyEquipableItemSetDefinition hash. It never leaves the optimizer input: stored
 * selections are keyed by raid key, and DIM never sees it.
 */
export function legacyRaidSetHash(key: LegacyRaidKey): number {
  return -(INDEX.get(key)! + 1);
}

export function isLegacyRaidSetHash(setHash: number): boolean {
  return setHash < 0;
}

/** One owned piece standing for its slot: what the row's slot strip draws. */
export interface LegacyRaidSlotPiece {
  name: string;
  icon?: string;
  watermark?: string;
}

export interface LegacyRaidInfo {
  key: LegacyRaidKey;
  name: string;
  /** How many of this raid's pieces the player owns (within the given list). */
  ownedCount: number;
  /** How many armor slots those pieces cover: the most one build can wear. */
  slotCount: number;
  /** The first owned piece per slot; slots with none are absent. */
  slots: Partial<Record<ArmorSlot, LegacyRaidSlotPiece>>;
}

/** The legacy raids `pieces` hold armor from, in release order. */
export function ownedLegacyRaids(
  pieces: readonly ({ legacyRaid?: LegacyRaidKey; slot: ArmorSlot } & LegacyRaidSlotPiece)[],
): LegacyRaidInfo[] {
  const owned = new Map<
    LegacyRaidKey,
    { count: number; slots: Partial<Record<ArmorSlot, LegacyRaidSlotPiece>> }
  >();
  for (const p of pieces) {
    if (!p.legacyRaid) continue;
    const entry = owned.get(p.legacyRaid) ?? { count: 0, slots: {} };
    entry.count++;
    entry.slots[p.slot] ??= {
      name: p.name,
      ...(p.icon ? { icon: p.icon } : {}),
      ...(p.watermark ? { watermark: p.watermark } : {}),
    };
    owned.set(p.legacyRaid, entry);
  }
  return LEGACY_RAIDS.flatMap((r) => {
    const entry = owned.get(r.key);
    return entry
      ? [
          {
            key: r.key,
            name: r.name,
            ownedCount: entry.count,
            slotCount: Object.keys(entry.slots).length,
            slots: entry.slots,
          },
        ]
      : [];
  });
}

/**
 * Raid requirements narrowed to what the owned pieces can make: a count above the slots
 * a raid's pieces cover drops to that many, and a raid with none owned goes. Returns
 * `reqs` itself when nothing changes.
 */
export function makeableRaidReqs(
  reqs: RaidReqs,
  raids: readonly LegacyRaidInfo[],
): RaidReqs {
  const slots = new Map(raids.map((r) => [r.key, r.slotCount]));
  let changed = false;
  const kept: RaidReqs = {};
  for (const [key, count] of Object.entries(reqs) as [LegacyRaidKey, number][]) {
    const made = Math.min(count, slots.get(key) ?? 0);
    if (made !== count) changed = true;
    if (made > 0) kept[key] = made;
  }
  return changed ? kept : reqs;
}

/** Raid requirements as the solver's set requirements (see legacyRaidSetHash). */
export function raidSetRequirements(reqs: RaidReqs): SetRequirement[] {
  return (Object.entries(reqs) as [LegacyRaidKey, number][]).map(([key, count]) => ({
    setHash: legacyRaidSetHash(key),
    count,
  }));
}

/** A stored raid requirement map: known raids with a whole count of 1–5. Anything else → {}. */
export function parseRaidReqs(v: unknown): RaidReqs {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: RaidReqs = {};
  for (const [key, count] of Object.entries(v)) {
    if (
      isLegacyRaidKey(key) &&
      Number.isInteger(count) &&
      (count as number) >= 1 &&
      (count as number) <= MAX_RAID_PIECES
    ) {
      out[key] = count as number;
    }
  }
  return out;
}
