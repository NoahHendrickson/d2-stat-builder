import { matchRank } from "./rank";

import type { InternedPerkColumn, PerkRef, WeaponSummary } from "./types";
import { damagePerkIndexSet } from "./damage-perks";
import type { WeaponNameIndex } from "./weapon-name-index";
import { matchesWeaponSourceLowered } from "./weapon-provenance";
import type { WeaponSearcher } from "./weapon-searcher";
import { isCatalogWeapon } from "./weapon-variants";

export type { WeaponNameIndex } from "./weapon-name-index";
export { buildWeaponNameIndex } from "./weapon-name-index";

/** Shared default-locale collator — far cheaper than String#localeCompare in hot sorts. */
const collator = new Intl.Collator();
const compareStrings = (a: string, b: string): number => collator.compare(a, b);

export type WeaponSort = "name" | "season-desc" | "season-asc";

/** Composite key for season ordering: season number dominates, release index breaks ties. */
function seasonSortKey(weapon: WeaponSummary): number {
  return (weapon.seasonNumber ?? 0) * 1_000_000 + (weapon.releaseIndex ?? 0);
}

/** Sort weapon results — does not mutate the input array. */
export function sortWeapons(weapons: WeaponSummary[], order: WeaponSort): WeaponSummary[] {
  const sorted = [...weapons];
  if (order === "name") {
    sorted.sort((a, b) => compareStrings(a.name, b.name));
    return sorted;
  }
  if (order === "season-desc") {
    sorted.sort((a, b) => seasonSortKey(b) - seasonSortKey(a) || compareStrings(a.name, b.name));
    return sorted;
  }
  sorted.sort((a, b) => seasonSortKey(a) - seasonSortKey(b) || compareStrings(a.name, b.name));
  return sorted;
}

export interface WeaponFilters {
  /** OR within each facet; AND across facets. */
  element?: string[];
  type?: string[];
  ammo?: string[];
  rarity?: string[];
  frame?: string[];
  /** Acquisition source, e.g. "Root of Nightmares". */
  source?: string[];
  /** Release season name or number, e.g. "Season of the Wish" or "23". */
  season?: string[];
  /** Equipment slot: "Kinetic" | "Energy" | "Power". */
  slot?: string[];
  /** Perk rollable in the FIRST trait column (OR within). */
  trait1?: string[];
  /** Perk rollable in the SECOND trait column (OR within). */
  trait2?: string[];
  /** Perk rollable in either trait column; every selected perk must match somewhere. */
  trait?: string[];
  /** When true, the FIRST trait column must roll at least one damage perk. */
  trait1DamagePerks?: boolean;
  /** When true, the SECOND trait column must roll at least one damage perk. */
  trait2DamagePerks?: boolean;
  /** Perk rollable in the origin-trait column (OR within). */
  originTrait?: string[];
  /** Perk rollable in a barrel, magazine, or other gear column; every selected perk must match. */
  gear?: string[];
  /** Champion the weapon stuns intrinsically: "Barrier" | "Overload" | "Unstoppable" (OR within). */
  champion?: string[];
  /** Up to two trait perks that must roll together in separate trait columns, order-agnostic. */
  perkCombo?: string[];
  /** Weapon must be able to roll ALL of these perks in ANY column (case-insensitive). */
  perks?: string[];
  /** Each group is OR within; every selected custom group must match at least one perk. */
  customPerkGroups?: string[][];
  /** "Yes" = craftable at the engram table; "No" = not craftable (OR within). */
  craftable?: string[];
  /** OR within; exact case-insensitive weapon name match. */
  name?: string[];
  /** When set, keep only adept (`true`) or non-adept (`false`) weapons. */
  adept?: boolean;
  /** Keep weapons whose base Ammo Generation is strictly above this; weapons without the stat drop out. */
  ammoGenAbove?: number;
}

const lower = (s: string) => s.toLowerCase();

/** Lowered selected-facet values; an empty set means "no constraint". */
function loweredSet(values?: string[]): Set<string> {
  const set = new Set<string>();
  for (const value of values ?? []) set.add(lower(value));
  return set;
}

function facetMatches(value: string, wanted: Set<string>): boolean {
  return wanted.size === 0 || wanted.has(lower(value));
}

function seasonFacetValue(weapon: WeaponSummary): string | undefined {
  if (weapon.seasonName) return weapon.seasonName;
  return weapon.seasonNumber != null ? `Season ${weapon.seasonNumber}` : undefined;
}

function seasonAliases(weapon: WeaponSummary): string[] {
  return weapon.seasonNumber != null
    ? [String(weapon.seasonNumber), `Season ${weapon.seasonNumber}`]
    : [];
}

/**
 * Per-weapon rollable-perk set, memoized for the session — `filterWeapons` runs
 * per keystroke, so don't rebuild the Set per weapon per call. Refreshed
 * summaries are new objects, so stale entries simply fall out of the WeakMap.
 */
const perksLowerSets = new WeakMap<WeaponSummary, Set<string>>();

function perksLowerSet(weapon: WeaponSummary): Set<string> {
  let set = perksLowerSets.get(weapon);
  if (!set) {
    set = new Set(weapon.perksLower);
    perksLowerSets.set(weapon, set);
  }
  return set;
}

function traitColumns(columns: InternedPerkColumn[]): InternedPerkColumn[] {
  return columns.filter((c) => c.kind === "Trait");
}

/** Barrel, magazine, and their sword/bow/fusion counterparts: every column but frame, traits, origin. */
function isGearColumn(column: InternedPerkColumn): boolean {
  return column.kind !== "Intrinsic" && column.kind !== "Trait" && column.kind !== "Origin Trait";
}

function columnPerks(column: InternedPerkColumn | undefined, perks: PerkRef[]): PerkRef[] {
  if (!column) return [];
  return column.perkIndices
    .map((index) => perks[index])
    .filter((perk): perk is PerkRef => perk != null);
}

/**
 * True if `column` can roll any of the (already-lowercased) `wanted` names.
 * Empty `wanted` = no constraint. Avoids allocating a Set per weapon by testing
 * the column's perks against the caller-precomputed `wanted` set directly.
 */
function columnRollsAny(
  column: InternedPerkColumn | undefined,
  wanted: Set<string>,
  perks: PerkRef[],
): boolean {
  if (wanted.size === 0) return true;
  if (!column) return false;
  return column.perkIndices.some((index) => {
    const perk = perks[index];
    return perk != null && wanted.has(lower(perk.name));
  });
}

function columnRollsName(
  column: InternedPerkColumn | undefined,
  wanted: string,
  perks: PerkRef[],
): boolean {
  if (!column) return false;
  return column.perkIndices.some((index) => {
    const perk = perks[index];
    return perk != null && lower(perk.name) === wanted;
  });
}

/** True if `column` can roll any perk whose catalog index is in `indices`. */
function columnRollsAnyIndex(
  column: InternedPerkColumn | undefined,
  indices: ReadonlySet<number>,
): boolean {
  if (!column) return false;
  return column.perkIndices.some((index) => indices.has(index));
}

function traitComboMatches(
  traits: InternedPerkColumn[],
  wanted: readonly string[],
  perks: PerkRef[],
): boolean {
  const first = wanted[0];
  if (!first) return true;

  const trait1 = traits[0];
  const trait2 = traits[1];
  const second = wanted[1];
  if (!second) {
    return columnRollsName(trait1, first, perks) || columnRollsName(trait2, first, perks);
  }

  return (
    (columnRollsName(trait1, first, perks) && columnRollsName(trait2, second, perks)) ||
    (columnRollsName(trait1, second, perks) && columnRollsName(trait2, first, perks))
  );
}

function traitColumnsRollEvery(
  traits: InternedPerkColumn[],
  wanted: ReadonlySet<string>,
  perks: PerkRef[],
): boolean {
  for (const name of wanted) {
    if (!columnRollsName(traits[0], name, perks) && !columnRollsName(traits[1], name, perks)) {
      return false;
    }
  }
  return true;
}

/** Filter weapons by attribute facets, position-aware trait columns, and required perks. */
export function filterWeapons(
  weapons: WeaponSummary[],
  filters: WeaponFilters,
  perks: PerkRef[],
): WeaponSummary[] {
  const requiredPerks = (filters.perks ?? []).map(lower);
  const perkCombo = [...new Set((filters.perkCombo ?? []).map(lower).filter(Boolean))].slice(0, 2);
  const customPerkGroups = (filters.customPerkGroups ?? [])
    .map((group) => group.map(lower).filter(Boolean))
    .filter((group) => group.length > 0);
  // Lowercase the (tiny) filter value lists once, not per weapon×facet.
  const nameWanted = loweredSet(filters.name);
  const elementWanted = loweredSet(filters.element);
  const typeWanted = loweredSet(filters.type);
  const ammoWanted = loweredSet(filters.ammo);
  const rarityWanted = loweredSet(filters.rarity);
  const slotWanted = loweredSet(filters.slot);
  const frameWanted = loweredSet(filters.frame);
  const seasonWanted = new Set((filters.season ?? []).map((s) => lower(s.trim())));
  const sourceActive = (filters.source?.length ?? 0) > 0;
  const sourceWanted = (filters.source ?? []).map((s) => lower(s.trim()));
  const trait1Wanted = loweredSet(filters.trait1);
  const trait2Wanted = loweredSet(filters.trait2);
  const traitWanted = loweredSet(filters.trait);
  const originWanted = loweredSet(filters.originTrait);
  const gearWanted = loweredSet(filters.gear);
  const championWanted = loweredSet(filters.champion);
  const damageIndices =
    filters.trait1DamagePerks || filters.trait2DamagePerks ? damagePerkIndexSet(perks) : null;
  const craftableActive = (filters.craftable?.length ?? 0) > 0;
  let craftableYes = false;
  let craftableNo = false;
  for (const value of filters.craftable ?? []) {
    const v = lower(value);
    if (v === "yes") craftableYes = true;
    else if (v === "no") craftableNo = true;
  }
  const needsOwned = requiredPerks.length > 0 || customPerkGroups.length > 0;
  return weapons.filter((w) => {
    if (!isCatalogWeapon(w)) return false;
    if (!facetMatches(w.name, nameWanted)) return false;
    if (!facetMatches(w.element, elementWanted)) return false;
    if (!facetMatches(w.type, typeWanted)) return false;
    if (!facetMatches(w.ammo, ammoWanted)) return false;
    if (!facetMatches(w.rarity, rarityWanted)) return false;
    if (!facetMatches(w.slot, slotWanted)) return false;
    if (frameWanted.size && !frameWanted.has(lower(w.frame ?? ""))) return false;
    if (championWanted.size && !w.champions?.some((c) => championWanted.has(lower(c)))) {
      return false;
    }
    if (sourceActive && !matchesWeaponSourceLowered(w.source, sourceWanted, w.sources)) {
      return false;
    }
    if (seasonWanted.size) {
      const season = seasonFacetValue(w);
      if (!season) return false;
      if (
        !seasonWanted.has(lower(season)) &&
        !seasonAliases(w).some((alias) => seasonWanted.has(lower(alias)))
      ) {
        return false;
      }
    }
    if (craftableActive && !(w.craftable ? craftableYes : craftableNo)) return false;
    if (filters.adept != null && w.adept !== filters.adept) return false;
    if (filters.ammoGenAbove != null && !((w.ammoGeneration ?? -1) > filters.ammoGenAbove)) {
      return false;
    }
    if (
      trait1Wanted.size ||
      trait2Wanted.size ||
      traitWanted.size ||
      damageIndices ||
      perkCombo.length > 0
    ) {
      const traits = traitColumns(w.columns);
      if (!columnRollsAny(traits[0], trait1Wanted, perks)) return false;
      if (!columnRollsAny(traits[1], trait2Wanted, perks)) return false;
      if (!traitColumnsRollEvery(traits, traitWanted, perks)) return false;
      if (!traitComboMatches(traits, perkCombo, perks)) return false;
      if (damageIndices) {
        if (filters.trait1DamagePerks && !columnRollsAnyIndex(traits[0], damageIndices)) {
          return false;
        }
        if (filters.trait2DamagePerks && !columnRollsAnyIndex(traits[1], damageIndices)) {
          return false;
        }
      }
    }
    if (
      originWanted.size &&
      !columnRollsAny(
        w.columns.find((c) => c.kind === "Origin Trait"),
        originWanted,
        perks,
      )
    ) {
      return false;
    }
    if (gearWanted.size) {
      const gear = w.columns.filter(isGearColumn);
      for (const name of gearWanted) {
        if (!gear.some((column) => columnRollsName(column, name, perks))) return false;
      }
    }
    if (needsOwned) {
      const owned = perksLowerSet(w);
      if (!requiredPerks.every((p) => owned.has(p))) return false;
      if (!customPerkGroups.every((group) => group.some((p) => owned.has(p)))) return false;
    }
    return true;
  });
}

function weaponNameRank(nameLower: string, queryLower: string): number | null {
  const rank = matchRank(nameLower, queryLower);
  // Weapon names: treat word-boundary same as contains for backward compat
  return rank != null && rank <= 2 ? rank : rank === 3 ? 2 : null;
}

export interface FilteredWeaponName {
  value: string;
  count: number;
  searchRank: number;
}

function rankNames(
  names: string[],
  namesLower: string[],
  countByName: Map<string, number>,
  ql: string,
): FilteredWeaponName[] {
  const matches: FilteredWeaponName[] = [];
  for (let i = 0; i < names.length; i++) {
    const rank = weaponNameRank(namesLower[i]!, ql);
    if (rank != null) {
      const value = names[i]!;
      matches.push({ value, count: countByName.get(value) ?? 1, searchRank: rank });
    }
  }
  return matches;
}

/**
 * Flat weapon-name matches — no sort (caller ranks).
 *
 * Pass a prebuilt {@link WeaponNameIndex} (recommended for keystroke-rate calls)
 * to skip rebuilding the name→count map and re-lowercasing every name. Without
 * one, counts are derived inline for backward compatibility.
 */
export function filterWeaponNames(
  weapons: WeaponSummary[],
  query: string,
  index?: WeaponNameIndex,
): FilteredWeaponName[] {
  const ql = query.trim().toLowerCase();
  if (!ql) return [];

  if (index) return rankNames(index.names, index.namesLower, index.countByName, ql);

  const counts = new Map<string, number>();
  for (const w of weapons) {
    counts.set(w.name, (counts.get(w.name) ?? 0) + 1);
  }
  const names = [...counts.keys()];
  const namesLower = names.map((name) => name.toLowerCase());
  return rankNames(names, namesLower, counts, ql);
}

/** Minimum query length before text search and name-match pinning apply. */
export const MIN_WEAPON_TEXT_QUERY_LENGTH = 2;

/** Canonical tie-break order for `filterWeaponNames` results: rank, catalog count, alpha. */
export function sortFilteredWeaponNames(matches: FilteredWeaponName[]): FilteredWeaponName[] {
  return [...matches].sort(
    (a, b) =>
      a.searchRank - b.searchRank || b.count - a.count || compareStrings(a.value, b.value),
  );
}

function appendUniqueWeapons(
  seen: Set<number>,
  target: WeaponSummary[],
  list: WeaponSummary[],
): void {
  for (const weapon of list) {
    if (!seen.has(weapon.hash)) {
      seen.add(weapon.hash);
      target.push(weapon);
    }
  }
}

/** Collect exact name hits plus fuzzy matches for a text query, deduped. */
export function weaponsMatchingTextQuery(
  weapons: WeaponSummary[],
  searcher: WeaponSearcher,
  query: string,
  limit: number,
  index?: WeaponNameIndex,
): WeaponSummary[] {
  const q = query.trim();
  if (q.length < MIN_WEAPON_TEXT_QUERY_LENGTH) return weapons;

  const seen = new Set<number>();
  const merged: WeaponSummary[] = [];

  const rankedNames = sortFilteredWeaponNames(filterWeaponNames(weapons, q, index));
  for (const { value } of rankedNames) {
    // O(1) expansion via the prebuilt name index; fall back to a scan otherwise.
    const named = (
      index?.byName.get(value) ?? weapons.filter((weapon) => weapon.name === value)
    ).filter(isCatalogWeapon);
    appendUniqueWeapons(seen, merged, named);
  }

  appendUniqueWeapons(seen, merged, searcher.search(q, limit));

  return merged;
}

function sortNameMatchedWeapons(
  weapons: WeaponSummary[],
  matches: FilteredWeaponName[],
  sort: WeaponSort,
): WeaponSummary[] {
  if (sort !== "name") return sortWeapons(weapons, sort);

  const rankByName = new Map(matches.map((match) => [match.value, match.searchRank]));
  return [...weapons].sort(
    (a, b) =>
      (rankByName.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
        (rankByName.get(b.name) ?? Number.MAX_SAFE_INTEGER) ||
      compareStrings(a.name, b.name),
  );
}

/** Sort weapons with exact name matches pinned above the rest; both groups respect `sort`. */
export function rankWeaponResults(
  weapons: WeaponSummary[],
  query: string,
  sort: WeaponSort,
  index?: WeaponNameIndex,
): WeaponSummary[] {
  const q = query.trim();
  if (q.length < MIN_WEAPON_TEXT_QUERY_LENGTH) {
    return sortWeapons(weapons, sort);
  }

  // Compute the ranked name matches once and thread them through — the
  // name-bucket sort below needs the same answer.
  const matches = filterWeaponNames(weapons, q, index);
  const nameMatches = new Set(matches.map((match) => match.value));
  const nameMatched: WeaponSummary[] = [];
  const rest: WeaponSummary[] = [];
  for (const weapon of weapons) {
    (nameMatches.has(weapon.name) ? nameMatched : rest).push(weapon);
  }

  return [...sortNameMatchedWeapons(nameMatched, matches, sort), ...sortWeapons(rest, sort)];
}

/** Typo-tolerant fuzzy search over weapon name/type/perk text — see weapon-searcher.ts. */
export { createWeaponSearcher, type WeaponSearcher } from "./weapon-searcher";

export interface FacetOption {
  value: string;
  count: number;
}

function sortFacetCounts(counts: Map<string, number>): FacetOption[] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || compareStrings(a.value, b.value));
}

/** Distinct facet values (with counts) for building filter UIs. */
export function collectFacets(weapons: WeaponSummary[]): Record<string, FacetOption[]> {
  const element = new Map<string, number>();
  const type = new Map<string, number>();
  const ammo = new Map<string, number>();
  const rarity = new Map<string, number>();
  const slot = new Map<string, number>();
  const frame = new Map<string, number>();
  const source = new Map<string, number>();
  const season = new Map<string, number>();
  const champion = new Map<string, number>();

  let craftableYes = 0;
  let craftableNo = 0;

  for (const w of weapons) {
    if (!isCatalogWeapon(w)) continue;
    if (w.element) element.set(w.element, (element.get(w.element) ?? 0) + 1);
    if (w.type) type.set(w.type, (type.get(w.type) ?? 0) + 1);
    if (w.ammo) ammo.set(w.ammo, (ammo.get(w.ammo) ?? 0) + 1);
    if (w.rarity) rarity.set(w.rarity, (rarity.get(w.rarity) ?? 0) + 1);
    if (w.slot) slot.set(w.slot, (slot.get(w.slot) ?? 0) + 1);
    if (w.frame) frame.set(w.frame, (frame.get(w.frame) ?? 0) + 1);
    for (const c of w.champions ?? []) champion.set(c, (champion.get(c) ?? 0) + 1);
    if (w.source) source.set(w.source, (source.get(w.source) ?? 0) + 1);
    const seasonValue = seasonFacetValue(w);
    if (seasonValue) season.set(seasonValue, (season.get(seasonValue) ?? 0) + 1);
    if (w.craftable) craftableYes++;
    else craftableNo++;
  }

  return {
    element: sortFacetCounts(element),
    type: sortFacetCounts(type),
    ammo: sortFacetCounts(ammo),
    rarity: sortFacetCounts(rarity),
    slot: sortFacetCounts(slot),
    frame: sortFacetCounts(frame),
    source: sortFacetCounts(source),
    season: sortFacetCounts(season),
    champion: sortFacetCounts(champion),
    craftable: [
      { value: "Yes", count: craftableYes },
      { value: "No", count: craftableNo },
    ],
  };
}

export interface PerkOption {
  name: string;
  hash: number;
  count: number;
  /** True if ≥1 weapon can currently roll this perk (for dimming retired perks). */
  currentlyCanRoll?: boolean;
}

/** Distinct perks across all weapons (for autocomplete / a perk directory). */
export function collectPerks(weapons: WeaponSummary[], perks: PerkRef[]): PerkOption[] {
  const byName = new Map<string, PerkOption>();
  for (const w of weapons) {
    const seen = new Set<string>();
    for (const column of w.columns) {
      for (const index of column.perkIndices) {
        const p = perks[index];
        if (!p) continue;
        const key = lower(p.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const existing = byName.get(key);
        if (existing) existing.count += 1;
        else byName.set(key, { name: p.name, hash: p.hash, count: 1 });
      }
    }
  }
  return [...byName.values()].sort((a, b) => compareStrings(a.name, b.name));
}

export interface ColumnPerkOptions {
  /** Either trait column, counted once per weapon. */
  trait: PerkOption[];
  trait1: PerkOption[];
  trait2: PerkOption[];
  originTrait: PerkOption[];
  /** Barrel, magazine, and other gear columns, counted once per weapon. */
  gear: PerkOption[];
}

/** Trait perks that roll in the column opposite `first` on some weapon, most weapons first. */
export function collectComboPartners(
  weapons: WeaponSummary[],
  perks: PerkRef[],
  first: string,
): PerkOption[] {
  const wanted = lower(first);
  const byName = new Map<string, PerkOption>();
  for (const w of weapons) {
    if (!isCatalogWeapon(w)) continue;
    const [a, b] = traitColumns(w.columns);
    const opposite = [
      ...(columnRollsName(a, wanted, perks) ? columnPerks(b, perks) : []),
      ...(columnRollsName(b, wanted, perks) ? columnPerks(a, perks) : []),
    ];
    const seen = new Set<string>();
    for (const perk of opposite) {
      const key = lower(perk.name);
      if (!key || key === wanted || seen.has(key)) continue;
      seen.add(key);
      const existing = byName.get(key);
      if (existing) existing.count += 1;
      else byName.set(key, { name: perk.name, hash: perk.hash, count: 1 });
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.count - a.count || compareStrings(a.name, b.name),
  );
}

/** Distinct perks per position-aware column for filter palette categories. */
export function collectColumnPerks(weapons: WeaponSummary[], perks: PerkRef[]): ColumnPerkOptions {
  const trait = new Map<string, PerkOption>();
  const trait1 = new Map<string, PerkOption>();
  const trait2 = new Map<string, PerkOption>();
  const originTrait = new Map<string, PerkOption>();
  const gear = new Map<string, PerkOption>();

  const add = (bucket: Map<string, PerkOption>, columnPerks: PerkRef[]) => {
    const seen = new Set<string>();
    for (const perk of columnPerks) {
      const key = lower(perk.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = bucket.get(key);
      if (existing) {
        existing.count += 1;
        existing.currentlyCanRoll = existing.currentlyCanRoll || perk.currentlyCanRoll;
      } else {
        bucket.set(key, {
          name: perk.name,
          hash: perk.hash,
          count: 1,
          currentlyCanRoll: perk.currentlyCanRoll,
        });
      }
    }
  };

  for (const w of weapons) {
    if (!isCatalogWeapon(w)) continue;
    const traits = traitColumns(w.columns);
    if (traits[0]) add(trait1, columnPerks(traits[0], perks));
    if (traits[1]) add(trait2, columnPerks(traits[1], perks));
    add(trait, [...columnPerks(traits[0], perks), ...columnPerks(traits[1], perks)]);
    const origin = w.columns.find((c) => c.kind === "Origin Trait");
    if (origin) add(originTrait, columnPerks(origin, perks));
    add(gear, w.columns.filter(isGearColumn).flatMap((c) => columnPerks(c, perks)));
  }

  const sort = (m: Map<string, PerkOption>) =>
    [...m.values()].sort((a, b) => b.count - a.count || compareStrings(a.name, b.name));
  return {
    trait: sort(trait),
    trait1: sort(trait1),
    trait2: sort(trait2),
    originTrait: sort(originTrait),
    gear: sort(gear),
  };
}
