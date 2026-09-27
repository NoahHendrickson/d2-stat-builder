import type { InternedPerkColumn, PerkColumn, PerkRef, WeaponDoc, WeaponSummary } from "./types";
import { sourceFields, sourceLabels } from "./weapon-provenance";

type WeaponVersionCandidate = Pick<
  WeaponSummary,
  "hash" | "name" | "craftable" | "seasonNumber" | "releaseIndex" | "superseded"
>;

type WeaponWithColumns = {
  columns: readonly (InternedPerkColumn | PerkColumn)[];
};

type WeaponPerkPoolVersionCandidate = WeaponVersionCandidate &
  Pick<WeaponSummary, "source" | "seasonName" | "adept"> &
  WeaponWithColumns;

const ADEPT_NAME_SUFFIX_RE = /\s*\((Adept|Timelost|Harrowed)\)\s*$/;

/** Strip Adept/Harrowed/Timelost suffixes for detail version grouping. */
export function weaponVersionFamilyName(name: string): string {
  return name.replace(ADEPT_NAME_SUFFIX_RE, "").trim();
}

/** Every catalog summary sharing a weapon's version family (base + adept tiers). */
export function weaponsInVersionFamily<T extends { name: string }>(
  weapons: readonly T[],
  name: string,
): T[] {
  const family = weaponVersionFamilyName(name);
  return weapons.filter((weapon) => weaponVersionFamilyName(weapon.name) === family);
}

export interface CurrentWeaponPerkPoolVersion<T extends WeaponPerkPoolVersionCandidate> {
  weapon: T;
  label: string;
  hashes: number[];
}

function groupWeaponsByName(weapons: WeaponDoc[]): Map<string, WeaponDoc[]> {
  const byName = new Map<string, WeaponDoc[]>();
  for (const weapon of weapons) {
    const list = byName.get(weapon.name);
    if (list) list.push(weapon);
    else byName.set(weapon.name, [weapon]);
  }
  return byName;
}

function copySourceFromLegacy(primary: WeaponDoc, legacy: readonly WeaponDoc[]): void {
  const donor = legacy.find((weapon) => weapon.source) ?? legacy[0];
  const source = primary.source ?? donor?.source;
  if (!source) return;
  const sources = [...sourceLabels(primary), ...legacy.flatMap((weapon) => sourceLabels(weapon))];
  Object.assign(primary, sourceFields(source, sources));
}

/**
 * Mark older same-name manifest defs superseded so browse/search surfaces show the
 * current perk pool. Handles craftable raid reprisals and non-craftable reissues
 * (e.g. Pantheon Threat Level). Legacy hashes remain for direct URL / vault lookup.
 */
export function reconcileCraftableTwins(weapons: WeaponDoc[]): WeaponDoc[] {
  const byName = groupWeaponsByName(weapons);
  const superseded = new Set<number>();

  for (const group of byName.values()) {
    if (group.length < 2) continue;

    const modern = [...group]
      .filter((weapon) => weapon.craftable)
      .sort((a, b) => b.releaseIndex - a.releaseIndex)[0];
    if (modern) {
      const legacy = group.filter(
        (weapon) => !weapon.craftable && weapon.releaseIndex < modern.releaseIndex,
      );
      if (legacy.length > 0) {
        copySourceFromLegacy(modern, legacy);
        for (const old of legacy) superseded.add(old.hash);
      }
      continue;
    }

    const sorted = [...group].sort((a, b) => b.releaseIndex - a.releaseIndex);
    const primary = sorted[0]!;
    const legacy = sorted.slice(1);
    copySourceFromLegacy(primary, legacy);
    for (const old of legacy) superseded.add(old.hash);
  }

  return weapons.map((weapon) =>
    superseded.has(weapon.hash) ? { ...weapon, superseded: true } : weapon,
  );
}

function adeptTierPoolKey(weapon: Pick<WeaponDoc, "name" | "source">): string {
  return `${weaponVersionFamilyName(weapon.name)}|${weapon.source ?? ""}`;
}

function mergePerkRefs(existing: PerkRef, incoming: PerkRef): PerkRef {
  const alternateHashes = [
    ...new Set([...(existing.alternateHashes ?? []), ...(incoming.alternateHashes ?? [])]),
  ];
  return {
    ...existing,
    icon: existing.icon ?? incoming.icon,
    description: existing.description ?? incoming.description,
    enhancedDescription: existing.enhancedDescription ?? incoming.enhancedDescription,
    currentlyCanRoll: existing.currentlyCanRoll || incoming.currentlyCanRoll,
    ...(alternateHashes.length > 0 ? { alternateHashes } : {}),
  };
}

/**
 * Union perks position-by-position across tier variants. Columns are matched by index and
 * the merged column inherits the first variant's `kind` — this assumes tier variants share
 * the same column order and socket layout (true for current weapons; a future manifest that
 * shifts a socket between tiers would silently mis-merge two different pools here).
 */
function mergeColumnPerks(weaponColumns: readonly PerkColumn[][]): PerkColumn[] {
  const maxColumns = Math.max(...weaponColumns.map((columns) => columns.length), 0);
  const merged: PerkColumn[] = [];

  for (let idx = 0; idx < maxColumns; idx += 1) {
    const slots = weaponColumns
      .map((columns) => columns[idx])
      .filter((column): column is PerkColumn => column != null);
    if (slots.length === 0) continue;

    const byName = new Map<string, PerkRef>();
    for (const slot of slots) {
      for (const entry of slot.perks) {
        const existing = byName.get(entry.name);
        byName.set(entry.name, existing ? mergePerkRefs(existing, entry) : entry);
      }
    }

    merged.push({
      kind: slots[0]!.kind,
      perks: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return merged;
}

function flattenWeaponPerkFields(
  columns: readonly PerkColumn[],
): Pick<WeaponDoc, "perks" | "perkHashes"> {
  const perkNames: string[] = [];
  const perkHashes: number[] = [];
  for (const column of columns) {
    for (const entry of column.perks) {
      if (entry.name) perkNames.push(entry.name);
      perkHashes.push(entry.hash);
      for (const alt of entry.alternateHashes ?? []) perkHashes.push(alt);
    }
  }
  return {
    perks: [...new Set(perkNames)],
    perkHashes: [...new Set(perkHashes)],
  };
}

/**
 * Union roll columns across normal and Timelost/Adept/Harrowed defs that share a
 * source within the same version family. Bungie now ships one roll pool per source;
 * manifest defs can still differ slightly per tier.
 *
 * This deliberately bets that same-source tiers are consolidated: a perk on either tier is
 * shown as rollable on both. If Bungie ever ships a same-source tier pair that was NOT
 * consolidated, the normal weapon would surface perks it can't actually roll — an accepted
 * simplification, matching the `craftable`/`adept` simplifications elsewhere in the index.
 */
export function reconcileAdeptTierPools(weapons: WeaponDoc[]): WeaponDoc[] {
  const byPoolKey = new Map<string, WeaponDoc[]>();
  for (const weapon of weapons) {
    const key = adeptTierPoolKey(weapon);
    const group = byPoolKey.get(key);
    if (group) group.push(weapon);
    else byPoolKey.set(key, [weapon]);
  }

  const mergedColumns = new Map<number, PerkColumn[]>();
  const mergedPerkFields = new Map<number, Pick<WeaponDoc, "perks" | "perkHashes">>();

  for (const group of byPoolKey.values()) {
    const hasAdept = group.some((weapon) => weapon.adept);
    const hasNormal = group.some((weapon) => !weapon.adept);
    if (!hasAdept || !hasNormal) continue;

    const columns = mergeColumnPerks(group.map((weapon) => weapon.columns));
    const perkFields = flattenWeaponPerkFields(columns);
    for (const weapon of group) {
      mergedColumns.set(weapon.hash, columns);
      mergedPerkFields.set(weapon.hash, perkFields);
    }
  }

  if (mergedColumns.size === 0) return weapons;

  return weapons.map((weapon) => {
    const columns = mergedColumns.get(weapon.hash);
    const perkFields = mergedPerkFields.get(weapon.hash);
    if (!columns || !perkFields) return weapon;
    return { ...weapon, columns, ...perkFields };
  });
}

/** Browse/search surfaces should ignore manifest legacy duplicates. */
export function isCatalogWeapon(weapon: { superseded?: boolean }): boolean {
  return weapon.superseded !== true;
}

/**
 * Recency key for picking the display version of a same-name weapon group.
 * Manifest `item.index` (`releaseIndex`) is authoritative for reprised duplicates;
 * `seasonNumber` only breaks ties because reprisals often lack season metadata.
 */
export function weaponVersionSortKey(weapon: WeaponVersionCandidate): number {
  return weapon.releaseIndex * 1_000 + (weapon.seasonNumber ?? 0);
}

/** Same-name weapon versions, newest catalog entry first. */
export function sortWeaponVersions<T extends WeaponVersionCandidate>(weapons: readonly T[]): T[] {
  return weapons
    .filter(isCatalogWeapon)
    .sort(
      (a, b) =>
        weaponVersionSortKey(b) - weaponVersionSortKey(a) ||
        Number(b.craftable) - Number(a.craftable) ||
        b.hash - a.hash,
    );
}

/** Latest catalog version for a same-name weapon group. */
export function primaryWeaponVersion<T extends WeaponVersionCandidate>(
  weapons: readonly T[],
): T | undefined {
  return sortWeaponVersions(weapons)[0];
}

/** Primary catalog version for a stored/raw weapon hash. */
export function primaryCatalogWeaponForHash<T extends WeaponVersionCandidate>(
  hash: number,
  byHash: ReadonlyMap<number, T>,
  byName?: ReadonlyMap<string, readonly T[]>,
): T | undefined {
  const weapon = byHash.get(hash);
  if (!weapon) return undefined;

  const versions = byName?.get(weapon.name) ?? [weapon];
  return primaryWeaponVersion(versions);
}

/** Collapse a ranked list to one visible row per current same-name perk pool. */
export function collapseWeaponVersions<T extends WeaponPerkPoolVersionCandidate>(
  weapons: readonly T[],
  byName?: ReadonlyMap<string, readonly T[]>,
): T[] {
  const seenNames = new Set<string>();
  const collapsed: T[] = [];
  const candidatesByName = new Map<string, T[]>();
  const catalogCandidatesByName = new Map<string, T[]>();

  for (const weapon of weapons) {
    const candidates = candidatesByName.get(weapon.name);
    if (candidates) candidates.push(weapon);
    else candidatesByName.set(weapon.name, [weapon]);

    if (isCatalogWeapon(weapon)) {
      const catalogCandidates = catalogCandidatesByName.get(weapon.name);
      if (catalogCandidates) catalogCandidates.push(weapon);
      else catalogCandidatesByName.set(weapon.name, [weapon]);
    }
  }

  for (const weapon of weapons) {
    if (!isCatalogWeapon(weapon) || seenNames.has(weapon.name)) continue;
    seenNames.add(weapon.name);

    const allVersions = byName?.get(weapon.name) ?? candidatesByName.get(weapon.name) ?? [];
    const primary = primaryWeaponVersion(allVersions);
    if (!primary) continue;

    const filteredSameName = catalogCandidatesByName.get(weapon.name) ?? [];
    const pools = currentWeaponPerkPoolVersions(allVersions);
    const filteredPoolReps = new Set<number>();
    for (const match of filteredSameName) {
      const pool = weaponPerkPoolVersionForHash(pools, match.hash);
      if (pool) filteredPoolReps.add(pool.weapon.hash);
    }

    const matchingPools = pools.filter((entry) => filteredPoolReps.has(entry.weapon.hash));
    if (matchingPools.length > 0) {
      collapsed.push(...matchingPools.map((entry) => entry.weapon));
      continue;
    }

    collapsed.push(primary);
  }

  return collapsed;
}

function resolvedColumn(column: InternedPerkColumn | PerkColumn): column is PerkColumn {
  return "perks" in column;
}

function columnPerkPoolFingerprint(column: InternedPerkColumn | PerkColumn): string {
  const perkIds = resolvedColumn(column)
    ? column.perks.map((perk) => `${perk.hash}:${perk.name.toLowerCase()}`)
    : column.perkIndices.map((index) => String(index));
  return `${column.kind}:${perkIds.sort().join(",")}`;
}

function weaponPerkPoolFingerprint(weapon: WeaponWithColumns): string {
  return weapon.columns
    .filter((column) => column.kind !== "Intrinsic")
    .map(columnPerkPoolFingerprint)
    .sort()
    .join("|");
}

function tierVersionLabel(name: string, adept: boolean): string {
  if (!adept) return "Standard";
  return ADEPT_NAME_SUFFIX_RE.exec(name)?.[1] ?? "Standard";
}

function poolIsTierVariantSplit(versions: readonly WeaponPerkPoolVersionCandidate[]): boolean {
  if (versions.length < 2) return false;
  const sources = new Set(versions.map((weapon) => weapon.source ?? ""));
  if (sources.size !== 1) return false;
  return versions.some((weapon) => weapon.adept) && versions.some((weapon) => !weapon.adept);
}

function sortTierVersions<T extends WeaponPerkPoolVersionCandidate>(versions: readonly T[]): T[] {
  return [...versions].sort(
    (a, b) =>
      Number(a.adept) - Number(b.adept) ||
      weaponVersionSortKey(b) - weaponVersionSortKey(a) ||
      b.hash - a.hash,
  );
}

function versionLabel<T extends WeaponPerkPoolVersionCandidate>(versions: readonly T[]): string {
  const rep = versions.find((weapon) => !weapon.adept) ?? versions[0]!;
  const source = versions.find((weapon) => weapon.source)?.source;
  const seasonName = versions.find((weapon) => weapon.seasonName)?.seasonName;
  return source ?? seasonName ?? `Hash ${rep.hash}`;
}

function weaponWithPoolSource<T extends WeaponPerkPoolVersionCandidate>(versions: readonly T[]): T {
  const representative = versions.find((weapon) => !weapon.adept) ?? versions[0]!;
  const source = versions.find((weapon) => weapon.source)?.source;
  if (representative.source || !source) return representative;
  return { ...representative, source } as T;
}

/** Current, distinct perk pools for a same-name detail selector. */
export function currentWeaponPerkPoolVersions<T extends WeaponPerkPoolVersionCandidate>(
  weapons: readonly T[],
): CurrentWeaponPerkPoolVersion<T>[] {
  const byPool = new Map<string, T[]>();

  for (const weapon of sortWeaponVersions(weapons)) {
    const poolKey = weaponPerkPoolFingerprint(weapon);
    const versions = byPool.get(poolKey);
    if (versions) versions.push(weapon);
    else byPool.set(poolKey, [weapon]);
  }

  return [...byPool.values()].flatMap((versions) => {
    if (poolIsTierVariantSplit(versions)) {
      return sortTierVersions(versions).map((weapon) => ({
        weapon: weaponWithPoolSource([weapon]),
        label: tierVersionLabel(weapon.name, weapon.adept),
        hashes: [weapon.hash],
      }));
    }

    return [
      {
        weapon: weaponWithPoolSource(versions),
        label: versionLabel(versions),
        hashes: versions.map((weapon) => weapon.hash),
      },
    ];
  });
}

/** Resolve which current perk-pool option contains a weapon hash. */
export function weaponPerkPoolVersionForHash<T extends WeaponPerkPoolVersionCandidate>(
  versions: readonly CurrentWeaponPerkPoolVersion<T>[],
  hash: number,
): CurrentWeaponPerkPoolVersion<T> | undefined {
  return versions.find((version) => version.hashes.includes(hash));
}

function addUniqueName(target: string[], seen: Set<string>, name: string): void {
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(name);
}

/** Origin Trait options for one weapon, supporting both full and interned columns. */
export function originTraitNamesForWeapon(
  weapon: WeaponWithColumns,
  perks: readonly PerkRef[] = [],
): string[] {
  const origin = weapon.columns.find((column) => column.kind === "Origin Trait");
  if (!origin) return [];

  const names: string[] = [];
  const seen = new Set<string>();

  if (resolvedColumn(origin)) {
    for (const perk of origin.perks) addUniqueName(names, seen, perk.name);
    return names;
  }

  for (const index of origin.perkIndices) {
    const perk = perks[index];
    if (perk) addUniqueName(names, seen, perk.name);
  }
  return names;
}

/** Distinct Origin Trait options across catalog-visible versions, preserving input order. */
export function originTraitNamesForWeapons<T extends WeaponWithColumns & { superseded?: boolean }>(
  weapons: readonly T[],
  perks: readonly PerkRef[] = [],
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const weapon of weapons) {
    if (!isCatalogWeapon(weapon)) continue;
    for (const name of originTraitNamesForWeapon(weapon, perks)) {
      addUniqueName(names, seen, name);
    }
  }

  return names;
}
