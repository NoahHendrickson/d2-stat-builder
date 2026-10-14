/**
 * Legacy raid armor: the Armor 2.0 raid sets from before Edge of Fate. They have no set
 * bonus. Each piece instead carries a raid mod socket, and that raid's mods only work
 * inside it. A piece is identified by the socket's plug category, which its "Empty Mod
 * Socket" and every mod that fits share (one category per raid, always socket 11 in the
 * live manifest). Last Wish's is named like a seasonal one (`season_outlaw`), but its
 * mods say they only work in Last Wish. No more Armor 2.0 raid armor will ship, so the
 * list is closed.
 *
 * Runtime imports are relative (not `@/`) so the module also runs under vitest.
 */
import type { Manifest } from "../manifest/load";
import { memoByManifest } from "../manifest/memo";
import { syntheticSetHash } from "../optimizer/synthetic-set";
import type { SetRequirement } from "../optimizer/types";
import { ARMOR_SLOTS, type ArmorSlot } from "./stats";

/**
 * Release order, which is also the order the builder lists them in. `id` is fixed for
 * good: the raid's synthetic set hash is built from it (legacyRaidSetHash), and that
 * hash is part of the stored build-usage keys. Never renumber or reuse one; a raid
 * added later takes the next unused id.
 */
export const LEGACY_RAIDS = [
  { key: "lw", id: 8, name: "Last Wish", category: "enhancements.season_outlaw" },
  { key: "garden", id: 0, name: "Garden of Salvation", category: "enhancements.raid_garden" },
  { key: "dsc", id: 1, name: "Deep Stone Crypt", category: "enhancements.raid_descent" },
  { key: "vog", id: 2, name: "Vault of Glass", category: "enhancements.raid_v520" },
  { key: "vow", id: 3, name: "Vow of the Disciple", category: "enhancements.raid_v600" },
  { key: "kf", id: 4, name: "King's Fall", category: "enhancements.raid_v620" },
  { key: "ron", id: 5, name: "Root of Nightmares", category: "enhancements.raid_v700" },
  { key: "crota", id: 6, name: "Crota's End", category: "enhancements.raid_v720" },
  { key: "se", id: 7, name: "Salvation's Edge", category: "enhancements.raid_v800" },
] as const;

export type LegacyRaidKey = (typeof LEGACY_RAIDS)[number]["key"];

/** Raid → how many of its pieces every build must wear (1–5). */
export type RaidReqs = Partial<Record<LegacyRaidKey, number>>;

/** The most pieces a requirement can ask for: every armor slot. */
export const MAX_RAID_PIECES = ARMOR_SLOTS.length;

type LegacyRaid = (typeof LEGACY_RAIDS)[number];
const BY_KEY = new Map<string, LegacyRaid>(LEGACY_RAIDS.map((r) => [r.key, r]));
const BY_CATEGORY = new Map<string, LegacyRaidKey>(
  LEGACY_RAIDS.map((r) => [r.category, r.key]),
);
const BY_SET_HASH = new Map<number, LegacyRaidKey>(
  LEGACY_RAIDS.map((r) => [syntheticSetHash(r.id), r.key]),
);

export function isLegacyRaidKey(v: unknown): v is LegacyRaidKey {
  return typeof v === "string" && BY_KEY.has(v);
}

export function legacyRaidName(key: LegacyRaidKey): string {
  return BY_KEY.get(key)!.name;
}

/** The raid a raid mod socket's plug category belongs to, if any. */
export function legacyRaidForCategory(category: string): LegacyRaidKey | undefined {
  return BY_CATEGORY.get(category);
}

/**
 * The raid whose mod socket an item definition has, if any: the first socket whose
 * initial plug is in `raidByPlug` (plug hash → raid; see raidPlugs).
 */
export function legacyRaidOf(
  def: { sockets?: { socketEntries?: { singleInitialItemHash?: number }[] } },
  raidByPlug: ReadonlyMap<number, LegacyRaidKey>,
): LegacyRaidKey | undefined {
  for (const entry of def.sockets?.socketEntries ?? []) {
    const key = entry.singleInitialItemHash && raidByPlug.get(entry.singleInitialItemHash);
    if (key) return key;
  }
  return undefined;
}

/**
 * Every plug in a raid mod socket category, mapped to its raid: one pass over the item
 * table per manifest, so reading a piece's raid is a few map lookups however often the
 * profile is normalized.
 */
const raidPlugs = memoByManifest((manifest) => {
  const out = new Map<number, LegacyRaidKey>();
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const cat = table[key].plug?.plugCategoryIdentifier;
    const raid = cat ? BY_CATEGORY.get(cat) : undefined;
    if (raid) out.set(Number(key), raid);
  }
  return out;
});

/** legacyRaidOf, against the manifest's raid plugs (built on the first socketed def). */
export function legacyRaidOfDef(
  def: Parameters<typeof legacyRaidOf>[0],
  manifest: Manifest,
): LegacyRaidKey | undefined {
  if (!def.sockets?.socketEntries?.length) return undefined;
  return legacyRaidOf(def, raidPlugs(manifest));
}

/**
 * The optimizer's set hash for a raid: a synthetic set from the raid's fixed `id`, since
 * "wear N pieces of this raid" is a set requirement to the solver. Stored selections are
 * keyed by raid key and DIM never sees it, but the build-usage history stores it inside
 * its query keys, which is why `id` must never change.
 */
export function legacyRaidSetHash(key: LegacyRaidKey): number {
  return syntheticSetHash(BY_KEY.get(key)!.id);
}

/** The legacy raids a query's set requirements require pieces of. */
export function requiredLegacyRaids(
  reqs: readonly SetRequirement[] | undefined,
): Set<LegacyRaidKey> {
  const out = new Set<LegacyRaidKey>();
  for (const r of reqs ?? []) {
    const key = BY_SET_HASH.get(r.setHash);
    if (key) out.add(key);
  }
  return out;
}

/**
 * The set a piece counts toward on the build card's set pills: its manifest armor set,
 * or for legacy raid armor its raid. `name` is the raid's (a manifest set's comes from
 * its ArmorSetInfo). Raid pieces earn a pill from one piece, since each is a mod socket;
 * a set's bonus starts at two.
 */
export interface ArmorGroup {
  setHash: number;
  minBadge: 1 | 2;
  name?: string;
  raid?: LegacyRaidKey;
}

export function armorGroupOf(piece: {
  setHash?: number;
  legacyRaid?: LegacyRaidKey;
}): ArmorGroup | undefined {
  if (piece.setHash) return { setHash: piece.setHash, minBadge: 2 };
  if (piece.legacyRaid) {
    return {
      setHash: legacyRaidSetHash(piece.legacyRaid),
      minBadge: 1,
      name: `${legacyRaidName(piece.legacyRaid)} raid armor`,
      raid: piece.legacyRaid,
    };
  }
  return undefined;
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
