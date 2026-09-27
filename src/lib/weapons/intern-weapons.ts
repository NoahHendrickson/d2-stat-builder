import { isCatalogWeapon } from "./weapon-variants";
import type {
  InternedPerkColumn,
  PerkColumn,
  PerkRef,
  WeaponDetailFields,
  WeaponDetailIndex,
  WeaponDoc,
  WeaponIndex,
  WeaponSummary,
} from "./types";
import { AMMO_GENERATION_STAT_HASH } from "./weapon-stats";

const lower = (s: string) => s.toLowerCase();

/** Ensure a summary carries `perksLower`, deriving it from `perks` when absent. */
function withPerksLower(summary: WeaponSummary): WeaponSummary {
  if (Array.isArray(summary.perksLower)) return summary;
  return { ...summary, perksLower: summary.perks.map(lower) };
}

/**
 * `JSON.stringify` replacer that omits the re-derivable `perksLower` field from the
 * serialized index — it's a lowercased duplicate of `perks`, rebuilt at load by
 * {@link normalizeWeaponIndex}. Shared by `generate.ts`, `write-sample-indexes.ts`,
 * and the round-trip tests so every on-disk producer emits the same shape.
 */
export const stripPerksLowerReplacer = (key: string, value: unknown): unknown =>
  key === "perksLower" ? undefined : value;

function isLegacyColumn(
  column: InternedPerkColumn | PerkColumn,
): column is PerkColumn {
  return "perks" in column && Array.isArray(column.perks);
}

/** True when weapons still embed full PerkRef objects in columns (pre-interning format). */
export function isLegacyWeaponDoc(weapon: WeaponSummary | WeaponDoc): weapon is WeaponDoc {
  const first = weapon.columns[0];
  return first != null && isLegacyColumn(first);
}

/** Resolve interned columns to full perk objects. */
export function resolveInternedColumns(
  columns: InternedPerkColumn[],
  perks: PerkRef[],
): PerkColumn[] {
  return columns.map((column) => ({
    kind: column.kind,
    perks: column.perkIndices
      .map((index) => perks[index])
      .filter((perk): perk is PerkRef => perk != null),
  }));
}

/** Merge a browse summary with optional detail fields into a full WeaponDoc. */
export function expandWeapon(
  summary: WeaponSummary,
  detail: WeaponDetailFields | undefined,
  perks: PerkRef[],
): WeaponDoc {
  const { columns, perksLower: _perksLower, ...rest } = summary;
  void _perksLower;
  return {
    ...rest,
    screenshot: detail?.screenshot,
    flavor: detail?.flavor,
    stats: detail?.stats ?? [],
    investmentStats: detail?.investmentStats,
    statGroupHash: detail?.statGroupHash,
    masterworkOptions: detail?.masterworkOptions,
    columns: resolveInternedColumns(columns, perks),
  };
}

/** Merge browse summaries with Ammo Generation values from loaded detail records. */
export function enrichAmmoGenerationFromDetails(
  weapons: WeaponSummary[],
  details: ReadonlyMap<number, WeaponDetailFields>,
): WeaponSummary[] {
  let changed = false;
  const enriched = weapons.map((weapon) => {
    if (weapon.ammoGeneration != null) return weapon;
    const value = details
      .get(weapon.hash)
      ?.stats.find((stat) => stat.hash === AMMO_GENERATION_STAT_HASH)?.value;
    if (value == null) return weapon;
    changed = true;
    return { ...weapon, ammoGeneration: value };
  });
  return changed ? enriched : weapons;
}

/** Map every perk plug hash to its PerkRef from the global catalog. */
export function buildPerkMapFromCatalog(perks: PerkRef[]): Map<number, PerkRef> {
  const map = new Map<number, PerkRef>();
  for (const perk of perks) {
    if (!map.has(perk.hash)) map.set(perk.hash, perk);
    for (const alt of perk.alternateHashes ?? []) {
      if (!map.has(alt)) map.set(alt, perk);
    }
  }
  return map;
}

function buildWeaponsByPerkNameRecord(summaries: WeaponSummary[]): Record<string, number[]> {
  const record: Record<string, number[]> = {};
  for (const weapon of summaries) {
    if (!isCatalogWeapon(weapon)) continue;
    for (const name of weapon.perks) {
      const key = lower(name);
      (record[key] ??= []).push(weapon.hash);
    }
  }
  return record;
}

/** Intern full weapon docs into a compact browse index + separate detail map. */
export function internWeaponCatalog(
  weapons: WeaponDoc[],
  version: string,
  generatedAt = new Date().toISOString(),
): { index: WeaponIndex; detailIndex: WeaponDetailIndex } {
  const perks: PerkRef[] = [];
  const hashToIndex = new Map<number, number>();

  const internPerk = (perk: PerkRef): number => {
    const existing = hashToIndex.get(perk.hash);
    if (existing !== undefined) {
      const entry = perks[existing]!;
      // Same plug hash can differ per weapon pool — merge the richest metadata.
      entry.currentlyCanRoll = entry.currentlyCanRoll || perk.currentlyCanRoll;
      if (!entry.description && perk.description) entry.description = perk.description;
      if (!entry.enhancedDescription && perk.enhancedDescription) {
        entry.enhancedDescription = perk.enhancedDescription;
      }
      if (!entry.icon && perk.icon) entry.icon = perk.icon;
      if (perk.alternateHashes?.length) {
        const alts = new Set(entry.alternateHashes ?? []);
        for (const hash of perk.alternateHashes) alts.add(hash);
        entry.alternateHashes = [...alts];
      }
      if (perk.statMods?.length && !entry.statMods?.length) {
        entry.statMods = perk.statMods;
      }
      return existing;
    }

    const index = perks.length;
    perks.push({
      hash: perk.hash,
      name: perk.name,
      icon: perk.icon,
      currentlyCanRoll: perk.currentlyCanRoll,
      description: perk.description,
      enhancedDescription: perk.enhancedDescription,
      alternateHashes: perk.alternateHashes,
      statMods: perk.statMods,
    });
    hashToIndex.set(perk.hash, index);
    for (const alt of perk.alternateHashes ?? []) {
      hashToIndex.set(alt, index);
    }
    return index;
  };

  const summaries: WeaponSummary[] = weapons.map((weapon) => {
    const columns: InternedPerkColumn[] = weapon.columns.map((column) => ({
      kind: column.kind,
      perkIndices: column.perks.map((perk) => internPerk(perk)),
    }));
    const perkNames = [...new Set(weapon.perks)];
    const ammoGeneration = weapon.stats.find((s) => s.hash === AMMO_GENERATION_STAT_HASH)?.value;
    return {
      hash: weapon.hash,
      name: weapon.name,
      icon: weapon.icon,
      watermark: weapon.watermark,
      type: weapon.type,
      element: weapon.element,
      ammo: weapon.ammo,
      rarity: weapon.rarity,
      slot: weapon.slot,
      frame: weapon.frame,
      craftable: weapon.craftable,
      adept: weapon.adept,
      seasonNumber: weapon.seasonNumber,
      seasonName: weapon.seasonName,
      source: weapon.source,
      sources: weapon.sources,
      releaseIndex: weapon.releaseIndex,
      ...(weapon.superseded ? { superseded: true } : {}),
      ...(ammoGeneration != null ? { ammoGeneration } : {}),
      columns,
      perks: perkNames,
      perksLower: perkNames.map(lower),
      perkHashes: weapon.perkHashes,
    };
  });

  const details: Record<string, WeaponDetailFields> = {};
  for (const weapon of weapons) {
    details[String(weapon.hash)] = {
      hash: weapon.hash,
      screenshot: weapon.screenshot,
      flavor: weapon.flavor,
      stats: weapon.stats,
      investmentStats: weapon.investmentStats,
      statGroupHash: weapon.statGroupHash,
      ...(weapon.masterworkOptions?.length ? { masterworkOptions: weapon.masterworkOptions } : {}),
    };
  }

  return {
    index: {
      version,
      generatedAt,
      perks,
      weapons: summaries,
      weaponsByPerkName: buildWeaponsByPerkNameRecord(summaries),
      damageTypes: [],
      weaponTypes: [],
      ammoTypes: [],
    },
    detailIndex: { version, details },
  };
}

/** Convert a legacy index (full WeaponDoc[]) into the interned browse format. */
export function normalizeWeaponIndex(raw: {
  version: string;
  generatedAt: string;
  weapons: (WeaponSummary | WeaponDoc)[];
  damageTypes?: WeaponIndex["damageTypes"];
  weaponTypes?: WeaponIndex["weaponTypes"];
  ammoTypes?: WeaponIndex["ammoTypes"];
  perks?: PerkRef[];
  weaponsByPerkName?: Record<string, number[]>;
}): WeaponIndex {
  if (raw.perks?.length && raw.weaponsByPerkName) {
    return {
      version: raw.version,
      generatedAt: raw.generatedAt,
      perks: raw.perks,
      // `perksLower` is omitted from the serialized index — derive it once here.
      weapons: (raw.weapons as WeaponSummary[]).map(withPerksLower),
      weaponsByPerkName: raw.weaponsByPerkName,
      damageTypes: raw.damageTypes ?? [],
      weaponTypes: raw.weaponTypes ?? [],
      ammoTypes: raw.ammoTypes ?? [],
    };
  }

  const legacy = raw.weapons.filter(isLegacyWeaponDoc);
  if (legacy.length === 0) {
    return {
      version: raw.version,
      generatedAt: raw.generatedAt,
      perks: [],
      // Already-interned summaries: still re-derive `perksLower` (stripped on disk)
      // so this exit path honors the WeaponSummary contract like the others.
      weapons: (raw.weapons as WeaponSummary[]).map(withPerksLower),
      weaponsByPerkName: {},
      damageTypes: raw.damageTypes ?? [],
      weaponTypes: raw.weaponTypes ?? [],
      ammoTypes: raw.ammoTypes ?? [],
    };
  }

  const { index } = internWeaponCatalog(legacy, raw.version, raw.generatedAt);
  return {
    ...index,
    damageTypes: raw.damageTypes ?? [],
    weaponTypes: raw.weaponTypes ?? [],
    ammoTypes: raw.ammoTypes ?? [],
  };
}

/** Build a detail index from legacy full weapon docs (for sample fallback). */
export function buildDetailIndexFromDocs(
  weapons: WeaponDoc[],
  version: string,
  statGroups?: WeaponDetailIndex["statGroups"],
): WeaponDetailIndex {
  const details: Record<string, WeaponDetailFields> = {};
  for (const weapon of weapons) {
    details[String(weapon.hash)] = {
      hash: weapon.hash,
      screenshot: weapon.screenshot,
      flavor: weapon.flavor,
      stats: weapon.stats,
      investmentStats: weapon.investmentStats,
      statGroupHash: weapon.statGroupHash,
      ...(weapon.masterworkOptions?.length ? { masterworkOptions: weapon.masterworkOptions } : {}),
    };
  }
  return { version, details, statGroups };
}

/** Resolve weapon summaries from a precomputed weaponsByPerkName record. */
export function summariesForPerkName(
  name: string,
  weaponsByPerkName: Record<string, number[]>,
  byHash: Map<number, WeaponSummary>,
): WeaponSummary[] {
  const hashes = weaponsByPerkName[lower(name)] ?? [];
  return hashes
    .map((hash) => byHash.get(hash))
    .filter((weapon): weapon is WeaponSummary => weapon != null);
}
