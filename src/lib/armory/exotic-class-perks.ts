/**
 * Exotic class item (Solipsism / Stoicism / Relativism) Spirit perk catalog +
 * theoretical Armor 3.0 stat synthesis.
 *
 * Left-column Spirits carry primary/secondary (30/25) on their plug investmentStats
 * in the live manifest. Right-column Spirits do NOT encode tertiary in the manifest —
 * Bungie assigns it server-side — so we keep a preferred-tertiary table (thematic) and
 * remapping when it collides with the archetype. Owned matching rolls always win over
 * synthesis (their component-304 stats are authoritative).
 *
 * Column pools match DIM's exotic-class-item.ts (sockets 10 / 11).
 */
import type { Manifest } from "@/lib/manifest/load";
import type { ArmorPiece } from "./normalize";
import {
  ARMOR_ARCHETYPE_PLUG_CATEGORY,
  MASTERWORK_OFF_STAT_BONUS,
  STAT_HASH_TO_INDEX,
  STAT_ORDER,
  offArchetypeIndices,
  type StatArray,
} from "./stats";

/** Item hashes — Stoicism (Titan), Relativism (Hunter), Solipsism (Warlock). */
export const EXOTIC_CLASS_ITEM_HASHES = {
  stoicism: 266021826,
  relativism: 2809120022,
  solipsism: 2273643087,
} as const;

export const EXOTIC_CLASS_ITEM_HASH_SET = new Set<number>(
  Object.values(EXOTIC_CLASS_ITEM_HASHES),
);

/** Socket indices on the item def for the two Spirit columns (DIM / live defs). */
export const SPIRIT_SOCKET_LEFT = 10;
export const SPIRIT_SOCKET_RIGHT = 11;

/** Prefix for synthetic optimizer piece ids (no real instance — skip equip/DIM move). */
export const SYNTHETIC_CLASS_ITEM_ID_PREFIX = "synthetic-class-item:";

export function isSyntheticClassItemId(id: string): boolean {
  return id.startsWith(SYNTHETIC_CLASS_ITEM_ID_PREFIX);
}

/**
 * Column pools per exotic class item (socket 10 = left / archetype, 11 = right / tertiary).
 * Source: DestinyItemManager/DIM `exotic-class-item.ts`.
 */
export const EXOTIC_CLASS_ITEM_PLUGS: Record<
  number,
  { left: number[]; right: number[] }
> = {
  [EXOTIC_CLASS_ITEM_HASHES.stoicism]: {
    left: [
      1476923952, 1476923953, 1476923954, 3573490509, 3573490508, 3573490511,
      3573490510, 3573490505,
    ],
    right: [
      1476923955, 1476923956, 1476923957, 3573490504, 3573490507, 3573490506,
      3573490501, 3573490500,
    ],
  },
  [EXOTIC_CLASS_ITEM_HASHES.solipsism]: {
    left: [
      1476923952, 1476923953, 1476923954, 183430248, 183430255, 183430252,
      183430253, 183430250,
    ],
    right: [
      1476923955, 1476923956, 1476923957, 183430251, 183430254, 183430249,
      183430246, 183430247,
    ],
  },
  [EXOTIC_CLASS_ITEM_HASHES.relativism]: {
    left: [
      1476923952, 1476923953, 1476923954, 3751917999, 3751917998, 3751917997,
      3751917996, 3751917995,
    ],
    right: [
      1476923955, 1476923956, 1476923957, 3751917994, 3751917993, 3751917992,
      3751917991, 3751917990,
    ],
  },
};

/** Every Spirit plug hash we know about (union of all columns). */
export const SPIRIT_HASH_SET: ReadonlySet<number> = new Set(
  Object.values(EXOTIC_CLASS_ITEM_PLUGS).flatMap((p) => [...p.left, ...p.right]),
);

/**
 * Preferred tertiary STAT_ORDER index for each right-column Spirit.
 * Not in the manifest — thematic defaults from the Spirit's ability fantasy.
 * Verified so far: Cyrtarachne → grenade (community / Edge of Fate previews).
 * Remaining entries are thematic defaults pending owned-roll verification.
 */
export const RIGHT_SPIRIT_PREFERRED_TERTIARY: Record<number, number> = {
  // Shared
  1476923955: 4, // Star-Eater → Super
  1476923956: 5, // Synthoceps → Melee
  1476923957: 3, // Verity → Grenade
  // Hunter
  3751917994: 3, // Cyrtarachne → Grenade (verified)
  3751917993: 0, // Gyrfalcon → Weapons
  3751917992: 5, // Liar → Melee
  3751917991: 1, // Wormhusk → Health
  3751917990: 2, // Coyote → Class
  // Warlock
  183430251: 2, // Vesper → Class
  183430254: 4, // Harmony → Super
  183430249: 3, // Starfire → Grenade
  183430246: 2, // Swarm → Class
  183430247: 5, // Claw → Melee
  // Titan
  3573490504: 5, // Contact → Melee
  3573490507: 1, // Scars → Health
  3573490506: 4, // Horn → Super
  3573490501: 1, // Alpha Lupi → Health
  3573490500: 3, // Armamentarium → Grenade
};

/** T5 exotic class item archetype shape (matches live inventory fixtures). */
const PRIMARY = 30;
const SECONDARY = 25;
const TERTIARY = 20;

/**
 * Armor 3.0 archetype plug hashes (live manifest). Keyed by
 * `${primaryStatIndex},${secondaryStatIndex}` — archetype plugs themselves carry
 * no investmentStats, so this table bridges Spirit 30/25 pairs → named plugs/icons.
 */
export const ARCHETYPE_PLUG_BY_STATS: Record<string, number> = {
  "5,1": 3349393475, // Brawler — Melee / Health
  "1,2": 549468645, // Bulwark — Health / Class
  "4,1": 1418248448, // Colossus — Super / Health
  "3,2": 2222960133, // Demolitionist — Grenade / Class
  "3,4": 2937665788, // Grenadier — Grenade / Super
  "0,3": 1807652646, // Gunner — Weapons / Grenade
  "4,5": 4227065942, // Paragon — Super / Melee
  "0,4": 544009373, // Powerhouse — Weapons / Super
  "2,5": 351770835, // Reaver — Class / Melee
  "1,3": 2503381935, // Siegebreaker — Health / Grenade
  "5,0": 1687144140, // Skirmisher — Melee / Weapons
  "2,0": 2230428468, // Specialist — Class / Weapons
};

export interface ExoticClassItemInfo {
  hash: number;
  name: string;
  icon?: string;
  classType: number;
}

export interface SpiritPerkInfo {
  hash: number;
  name: string;
  icon?: string;
  column: 1 | 2;
  /** Left column only: primary/secondary STAT_ORDER indices from plug investmentStats. */
  primaryStat?: number;
  secondaryStat?: number;
  /** Left column: Armor 3.0 archetype name (e.g. "Paragon"). */
  archetypeName?: string;
  /** Left column: archetype plug icon path from the manifest. */
  archetypeIcon?: string;
  /** Right column: preferred tertiary index (before conflict remapping). */
  preferredTertiary?: number;
}

export function isExoticClassItemHash(hash: number): boolean {
  return EXOTIC_CLASS_ITEM_HASH_SET.has(hash);
}

/** Manifest exotic class items for a class (always the one def per class). */
export function availableExoticClassItems(
  manifest: Manifest,
  classType: number,
): ExoticClassItemInfo[] {
  const out: ExoticClassItemInfo[] = [];
  for (const hash of EXOTIC_CLASS_ITEM_HASH_SET) {
    const def = manifest.def("DestinyInventoryItemDefinition", hash);
    if (!def || def.classType !== classType) continue;
    out.push({
      hash,
      name: def.displayProperties?.name ?? "Unknown",
      icon: def.displayProperties?.icon,
      classType,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function archetypeFromPlug(
  manifest: Manifest,
  hash: number,
): { primary: number; secondary: number } | null {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  const inv = def?.investmentStats ?? [];
  const hits: { idx: number; value: number }[] = [];
  for (const s of inv) {
    const idx = STAT_HASH_TO_INDEX[s.statTypeHash];
    if (idx === undefined || s.isConditionallyActive) continue;
    hits.push({ idx, value: s.value });
  }
  hits.sort((a, b) => b.value - a.value);
  if (hits.length < 2) return null;
  return { primary: hits[0].idx, secondary: hits[1].idx };
}

/** Resolve the Armor 3.0 archetype plug for a primary/secondary pair. */
export function archetypePlugForStats(
  manifest: Manifest,
  primary: number,
  secondary: number,
): { name: string; icon?: string } | null {
  const plugHash = ARCHETYPE_PLUG_BY_STATS[`${primary},${secondary}`];
  if (plugHash === undefined) return null;
  const def = manifest.def("DestinyInventoryItemDefinition", plugHash);
  if (!def) return null;
  // Sanity: only accept real archetype plugs.
  const cat = def.plug?.plugCategoryIdentifier ?? "";
  if (!cat.includes(ARMOR_ARCHETYPE_PLUG_CATEGORY)) return null;
  return {
    name: def.displayProperties?.name ?? "Unknown",
    icon: def.displayProperties?.icon,
  };
}

/**
 * Armor 3.0 archetype display name for a left-column Spirit (exotic class items
 * have no armor_archetypes socket — the Spirit's investmentStats encode 30/25).
 */
export function archetypeNameFromSpirit(
  manifest: Manifest,
  leftSpiritHash: number,
): string | undefined {
  const arch = archetypeFromPlug(manifest, leftSpiritHash);
  if (!arch) return undefined;
  return archetypePlugForStats(manifest, arch.primary, arch.secondary)?.name;
}

/**
 * Spirit perks for one exotic class item, split by column, names/icons from manifest.
 */
export function availableSpiritPerks(
  manifest: Manifest,
  itemHash: number,
): { left: SpiritPerkInfo[]; right: SpiritPerkInfo[] } {
  const pools = EXOTIC_CLASS_ITEM_PLUGS[itemHash];
  if (!pools) return { left: [], right: [] };

  const toInfo = (hash: number, column: 1 | 2): SpiritPerkInfo => {
    const def = manifest.def("DestinyInventoryItemDefinition", hash);
    const info: SpiritPerkInfo = {
      hash,
      name: def?.displayProperties?.name ?? `Spirit ${hash}`,
      icon: def?.displayProperties?.icon,
      column,
    };
    if (column === 1) {
      const arch = archetypeFromPlug(manifest, hash);
      if (arch) {
        info.primaryStat = arch.primary;
        info.secondaryStat = arch.secondary;
        const plug = archetypePlugForStats(manifest, arch.primary, arch.secondary);
        if (plug) {
          info.archetypeName = plug.name;
          info.archetypeIcon = plug.icon;
        }
      }
    } else {
      info.preferredTertiary = RIGHT_SPIRIT_PREFERRED_TERTIARY[hash];
    }
    return info;
  };

  const left = pools.left.map((h) => toInfo(h, 1));
  const right = pools.right.map((h) => toInfo(h, 2));
  left.sort((a, b) => a.name.localeCompare(b.name));
  right.sort((a, b) => a.name.localeCompare(b.name));
  return { left, right };
}

/**
 * Resolve tertiary when the preferred index collides with primary/secondary:
 * first STAT_ORDER index that isn't either.
 */
export function resolveTertiary(
  preferred: number | undefined,
  primary: number,
  secondary: number,
): number {
  if (
    preferred !== undefined &&
    preferred !== primary &&
    preferred !== secondary
  ) {
    return preferred;
  }
  for (let i = 0; i < STAT_ORDER.length; i++) {
    if (i !== primary && i !== secondary) return i;
  }
  return 0;
}

/**
 * Base roll (pre-MW) for a Spirit pair: 30 / 25 / 20 on primary / secondary / tertiary.
 * Returns null if the left Spirit has no archetype investmentStats in the manifest.
 */
export function synthesizeClassItemBaseStats(
  manifest: Manifest,
  leftHash: number,
  rightHash: number,
): StatArray | null {
  const arch = archetypeFromPlug(manifest, leftHash);
  if (!arch) return null;
  const tertiary = resolveTertiary(
    RIGHT_SPIRIT_PREFERRED_TERTIARY[rightHash],
    arch.primary,
    arch.secondary,
  );
  const base: StatArray = [0, 0, 0, 0, 0, 0];
  base[arch.primary] = PRIMARY;
  base[arch.secondary] = SECONDARY;
  base[tertiary] = TERTIARY;
  return base;
}

/** Masterworked stats for a theoretical roll (MW5 → +5 on the three off-archetype stats). */
export function synthesizeClassItemStats(
  manifest: Manifest,
  leftHash: number,
  rightHash: number,
): StatArray | null {
  const base = synthesizeClassItemBaseStats(manifest, leftHash, rightHash);
  if (!base) return null;
  const out = base.slice() as StatArray;
  for (const i of offArchetypeIndices(base)) {
    out[i] = Math.max(out[i], MASTERWORK_OFF_STAT_BONUS);
  }
  return out;
}

/**
 * Whether an owned piece's Spirit pair matches the selection.
 * `null` in a column means Any.
 */
export function matchesSpiritSelection(
  piecePerks: [number, number] | undefined,
  selected: [number | null, number | null],
): boolean {
  if (!piecePerks) return false;
  const [left, right] = selected;
  if (left !== null && piecePerks[0] !== left) return false;
  if (right !== null && piecePerks[1] !== right) return false;
  return true;
}

export interface SyntheticClassItemParams {
  itemHash: number;
  left: number;
  right: number;
  name: string;
  icon?: string;
  classType: number;
}

/**
 * Build a theoretical T5 exotic class item for an unowned Spirit pair.
 * Returns null when the left Spirit has no archetype investmentStats.
 */
export function buildSyntheticClassItem(
  manifest: Manifest,
  params: SyntheticClassItemParams,
): ArmorPiece | null {
  const { itemHash, left, right, name, icon, classType } = params;
  const baseStats = synthesizeClassItemBaseStats(manifest, left, right);
  const stats = synthesizeClassItemStats(manifest, left, right);
  if (!baseStats || !stats) return null;
  return {
    instanceId: `${SYNTHETIC_CLASS_ITEM_ID_PREFIX}${itemHash}:${left}:${right}`,
    itemHash,
    name,
    icon,
    slot: "classItem",
    classType,
    isExotic: true,
    isArtifice: false,
    isFestivalMask: false,
    baseStats,
    stats,
    // Flexible exotic tuning — any +5 direction (same as owned T5 exotics).
    tunedStat: 0,
    exoticPerkHashes: [left, right],
    location: "vault",
  };
}

export interface SpiritSelectionParams {
  selectedClassItemHash: number;
  exoticPerks: [number | null, number | null];
  name: string;
  icon?: string;
  classType: number;
}

/**
 * Apply Spirit selection to a class-item pool: keep legendaries, keep matching
 * owned exotic rolls, and inject a synthetic T5 roll when a concrete pair has
 * no owned match. Returns `pieces` unchanged when no Spirit column is set.
 */
export function applySpiritSelectionToClassItems(
  pieces: ArmorPiece[],
  manifest: Manifest,
  params: SpiritSelectionParams,
): ArmorPiece[] {
  const { selectedClassItemHash, exoticPerks, name, icon, classType } = params;
  const [left, right] = exoticPerks;
  if (left === null && right === null) return pieces;

  const matching = pieces.filter(
    (p) =>
      p.isExotic &&
      p.itemHash === selectedClassItemHash &&
      matchesSpiritSelection(p.exoticPerkHashes, exoticPerks),
  );
  const next = [...pieces.filter((p) => !p.isExotic), ...matching];

  if (matching.length > 0 || left === null || right === null) return next;

  const synthetic = buildSyntheticClassItem(manifest, {
    itemHash: selectedClassItemHash,
    left,
    right,
    name,
    icon,
    classType,
  });
  return synthetic ? [...next, synthetic] : next;
}

/**
 * Synthetic piece for results lookup when a concrete Spirit pair has no owned
 * match. Returns null for partial (Any) selections or when synthesis fails.
 */
export function syntheticClassItemForSelection(
  pieces: ArmorPiece[],
  manifest: Manifest,
  params: SpiritSelectionParams,
): ArmorPiece | null {
  const { selectedClassItemHash, exoticPerks, name, icon, classType } = params;
  const [left, right] = exoticPerks;
  if (left === null || right === null) return null;

  const ownedMatch = pieces.some(
    (p) =>
      p.isExotic &&
      p.slot === "classItem" &&
      p.itemHash === selectedClassItemHash &&
      matchesSpiritSelection(p.exoticPerkHashes, exoticPerks),
  );
  if (ownedMatch) return null;

  return buildSyntheticClassItem(manifest, {
    itemHash: selectedClassItemHash,
    left,
    right,
    name,
    icon,
    classType,
  });
}
