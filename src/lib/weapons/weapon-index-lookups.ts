import { buildPerkMapFromCatalog, normalizeWeaponIndex, summariesForPerkName } from "./intern-weapons";
import { createWeaponSearcher, type WeaponSearcher } from "./weapon-searcher";
import type {
  AmmoTypeRef,
  DamageTypeRef,
  PerkRef,
  WeaponIndex,
  WeaponSummary,
  WeaponTypeRef,
} from "./types";
import { buildWeaponNameIndex, type WeaponNameIndex } from "./weapon-name-index";

/** Precomputed lookups over a weapon index for O(1) hash/perk resolution. */
export interface WeaponIndexLookups {
  weapons: WeaponSummary[];
  perks: PerkRef[];
  damageTypes: DamageTypeRef[];
  weaponTypes: WeaponTypeRef[];
  ammoTypes: AmmoTypeRef[];
  byHash: Map<number, WeaponSummary>;
  perkMap: Map<number, PerkRef>;
  /** Lowercase perk name → weapons that can roll it. */
  weaponsByPerkName: Map<string, WeaponSummary[]>;
  /** Perk hash → weapons that can roll it. */
  weaponsByPerkHash: Map<number, WeaponSummary[]>;
  weaponsByPerkNameRecord: Record<string, number[]>;
  /** Prebuilt name lookup for keystroke-rate autocomplete (built once). */
  nameIndex: WeaponNameIndex;
  /** Shared fuzzy searcher, built once per catalog. */
  weaponSearcher: WeaponSearcher;
  version?: string;
  generatedAt?: string;
}

function buildWeaponsByPerkHash(weapons: WeaponSummary[]): Map<number, WeaponSummary[]> {
  const weaponsByPerkHash = new Map<number, WeaponSummary[]>();
  for (const weapon of weapons) {
    for (const hash of weapon.perkHashes) {
      const matches = weaponsByPerkHash.get(hash);
      if (matches) matches.push(weapon);
      else weaponsByPerkHash.set(hash, [weapon]);
    }
  }
  return weaponsByPerkHash;
}

/** Build hash/perk maps from a parsed weapon index. */
export function buildWeaponIndexLookups(raw: WeaponIndex): WeaponIndexLookups {
  const index = normalizeWeaponIndex(raw);
  const byHash = new Map(index.weapons.map((w) => [w.hash, w]));
  const weaponsByPerkName = new Map<string, WeaponSummary[]>();
  for (const [name, hashes] of Object.entries(index.weaponsByPerkName)) {
    weaponsByPerkName.set(
      name,
      hashes
        .map((hash) => byHash.get(hash))
        .filter((weapon): weapon is WeaponSummary => weapon != null),
    );
  }

  return {
    weapons: index.weapons,
    perks: index.perks,
    damageTypes: index.damageTypes ?? [],
    weaponTypes: index.weaponTypes ?? [],
    ammoTypes: index.ammoTypes ?? [],
    byHash,
    perkMap: buildPerkMapFromCatalog(index.perks),
    weaponsByPerkName,
    weaponsByPerkHash: buildWeaponsByPerkHash(index.weapons),
    weaponsByPerkNameRecord: index.weaponsByPerkName,
    nameIndex: buildWeaponNameIndex(index.weapons),
    weaponSearcher: createWeaponSearcher(index.weapons),
    version: index.version,
    generatedAt: index.generatedAt,
  };
}

/** Rebuild hash/perk maps after mutating weapon summaries (e.g. detail enrichment). */
export function refreshWeaponSummaries(
  lookups: WeaponIndexLookups,
  weapons: WeaponSummary[],
): WeaponIndexLookups {
  if (weapons === lookups.weapons) return lookups;

  const byHash = new Map(weapons.map((w) => [w.hash, w]));
  const weaponsByPerkName = new Map<string, WeaponSummary[]>();
  for (const [name, hashes] of Object.entries(lookups.weaponsByPerkNameRecord)) {
    weaponsByPerkName.set(
      name,
      hashes
        .map((hash) => byHash.get(hash))
        .filter((weapon): weapon is WeaponSummary => weapon != null),
    );
  }

  return {
    ...lookups,
    weapons,
    byHash,
    weaponsByPerkName,
    weaponsByPerkHash: buildWeaponsByPerkHash(weapons),
    nameIndex: buildWeaponNameIndex(weapons),
    // Enrichment only touches ammoGeneration (not name/type/perks), so the
    // previous searcher's haystacks are reused — rebound, not rebuilt.
    weaponSearcher: createWeaponSearcher(weapons, lookups.weaponSearcher),
  };
}

export { summariesForPerkName };
