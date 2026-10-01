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

/** Bungie stat hash for the Ammo Generation weapon stat. */
export const AMMO_GENERATION_STAT_HASH = 1_931_675_084;

const lower = (s: string) => s.toLowerCase();

/** Ensure a summary carries `perksLower`, deriving it from `perks` when absent. */
function withPerksLower(summary: WeaponSummary): WeaponSummary {
  if (Array.isArray(summary.perksLower)) return summary;
  return { ...summary, perksLower: summary.perks.map(lower) };
}

function isLegacyColumn(
  column: InternedPerkColumn | PerkColumn,
): column is PerkColumn {
  return "perks" in column && Array.isArray(column.perks);
}

/** True when weapons still embed full PerkRef objects in columns (pre-interning format). */
function isLegacyWeaponDoc(weapon: WeaponSummary | WeaponDoc): weapon is WeaponDoc {
  const first = weapon.columns[0];
  return first != null && isLegacyColumn(first);
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
  const statNames = new Map<number, string>();
  for (const weapon of weapons) {
    for (const stat of weapon.stats) statNames.set(stat.hash, stat.name);
  }
  /** Perk stat modifiers by name; stats no weapon shows are dropped. */
  const namedStats = (mods: PerkRef["statMods"], names = statNames) => {
    const named: [string, number][] = [];
    for (const mod of mods ?? []) {
      const name = names.get(mod.hash);
      if (name) named.push([name, mod.value]);
    }
    return named.length ? Object.fromEntries(named) : undefined;
  };

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
        entry.stats = perk.stats ?? namedStats(perk.statMods);
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
      stats: perk.stats ?? namedStats(perk.statMods),
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
    // Masterworks share the perk table so the grid treats them like any plug.
    // They belong to this weapon, so its own stats name their modifiers.
    const ownStatNames = new Map(weapon.stats.map((s) => [s.hash, s.name]));
    const masterworks = (weapon.masterworkOptions ?? []).map((option) => {
      const stats = namedStats(option.statMods, ownStatNames);
      return internPerk({
        hash: option.plugHash,
        name: `${option.statName} Masterwork`,
        icon: option.icon,
        currentlyCanRoll: true,
        description: Object.entries(stats ?? {})
          .map(([name, value]) => `+${value} ${name}`)
          .join(", "),
        statMods: option.statMods,
        stats,
      });
    });
    const ammoGeneration = weapon.stats.find((s) => s.hash === AMMO_GENERATION_STAT_HASH)?.value;
    const shown = new Set(weapon.stats.filter((s) => s.value > 0).map((s) => s.hash));
    const statInvestment = Object.fromEntries(
      (weapon.investmentStats ?? [])
        .filter((s) => shown.has(s.hash))
        .map((s) => [s.name, s.value]),
    );
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
      ...(weapon.champions?.length ? { champions: weapon.champions } : {}),
      craftable: weapon.craftable,
      adept: weapon.adept,
      seasonNumber: weapon.seasonNumber,
      seasonName: weapon.seasonName,
      source: weapon.source,
      sources: weapon.sources,
      releaseIndex: weapon.releaseIndex,
      ...(weapon.superseded ? { superseded: true } : {}),
      ...(ammoGeneration != null ? { ammoGeneration } : {}),
      ...(Object.keys(statInvestment).length
        ? { statInvestment, statGroupHash: weapon.statGroupHash }
        : {}),
      ...(masterworks.length ? { masterworks } : {}),
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
  championTypes?: WeaponIndex["championTypes"];
  statCurves?: WeaponIndex["statCurves"];
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
      championTypes: raw.championTypes ?? [],
      statCurves: raw.statCurves,
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
      championTypes: raw.championTypes ?? [],
      statCurves: raw.statCurves,
    };
  }

  const { index } = internWeaponCatalog(legacy, raw.version, raw.generatedAt);
  return {
    ...index,
    damageTypes: raw.damageTypes ?? [],
    weaponTypes: raw.weaponTypes ?? [],
    ammoTypes: raw.ammoTypes ?? [],
    championTypes: raw.championTypes ?? [],
    statCurves: raw.statCurves,
  };
}
