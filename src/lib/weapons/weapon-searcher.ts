import uFuzzy from "@leeoniya/ufuzzy";

import type { WeaponSummary } from "./types";
import { isCatalogWeapon } from "./weapon-variants";

/** Typo-tolerant fuzzy search over weapon name/type/perk text. */
export interface WeaponSearcher {
  /** Ranked matches for `query`, deduped across fields, capped at `limit`. */
  search(query: string, limit: number): WeaponSummary[];
}

// intraMode 1 = one error per term, with every error kind enabled (they default
// to 0): substitution, transposition, omission, insertion — comparable typo
// tolerance to the old fuse.js threshold of 0.3.
const weaponFuzzy = new uFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1 });

/** Ranked haystack indices for a needle; empty when nothing matches. */
function fuzzyMatchIndices(haystack: string[], needle: string): number[] {
  // outOfOrder=1 lets multi-term queries match regardless of term order.
  const [idxs, info, order] = weaponFuzzy.search(haystack, needle, 1);
  if (!idxs) return [];
  // Over the ranking threshold uFuzzy returns the (unranked) filter result.
  if (order && info) return order.map((i) => info.idx[i]!);
  return [...idxs];
}

/** Per-field haystacks, in search priority order: name, type, perk text, combined. */
type SearchFields = [string[], string[], string[], string[]];

function buildSearchFields(catalog: WeaponSummary[]): SearchFields {
  const names: string[] = [];
  const types: string[] = [];
  const perkText: string[] = [];
  const combined: string[] = [];
  for (const weapon of catalog) {
    const perks = weapon.perks.join(" ");
    names.push(weapon.name);
    types.push(weapon.type);
    perkText.push(perks);
    combined.push(`${weapon.name} ${weapon.type} ${perks}`);
  }
  return [names, types, perkText, combined];
}

/**
 * True when every catalog weapon's searchable text matches the previous build.
 * `perks` compares by reference: summary refreshes spread-copy weapons, so an
 * untouched perk list keeps its identity; a real change forces a rebuild.
 */
function sameSearchText(prev: WeaponSummary[], next: WeaponSummary[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i]!;
    const b = next[i]!;
    if (a.name !== b.name || a.type !== b.type || a.perks !== b.perks) return false;
  }
  return true;
}

class CatalogWeaponSearcher implements WeaponSearcher {
  constructor(
    readonly catalog: WeaponSummary[],
    readonly fields: SearchFields,
  ) {}

  search(query: string, limit: number): WeaponSummary[] {
    const needle = query.trim();
    if (!needle) return [];
    const seen = new Set<number>();
    const matches: WeaponSummary[] = [];
    for (const haystack of this.fields) {
      if (matches.length >= limit) break;
      for (const index of fuzzyMatchIndices(haystack, needle)) {
        const weapon = this.catalog[index];
        if (!weapon || seen.has(weapon.hash)) continue;
        seen.add(weapon.hash);
        matches.push(weapon);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }
}

/**
 * Build a reusable fuzzy searcher for weapon name/type/perk text.
 *
 * Fields are searched in priority order — name, then type, then perk text,
 * then all three combined (so multi-term queries can span fields) — mirroring
 * the old fuse.js key weights (name 3×) as tiered buckets. Superseded legacy
 * twins are excluded, matching the catalog-only index that used to be shipped.
 *
 * Pass the `previous` searcher when refreshing summaries: if no weapon's
 * searchable text changed (e.g. ammo-gen enrichment), the haystacks are reused
 * and only rebound to the new summary objects.
 */
export function createWeaponSearcher(
  weapons: WeaponSummary[],
  previous?: WeaponSearcher,
): WeaponSearcher {
  const catalog = weapons.filter(isCatalogWeapon);
  const fields =
    previous instanceof CatalogWeaponSearcher && sameSearchText(previous.catalog, catalog)
      ? previous.fields
      : buildSearchFields(catalog);
  return new CatalogWeaponSearcher(catalog, fields);
}
