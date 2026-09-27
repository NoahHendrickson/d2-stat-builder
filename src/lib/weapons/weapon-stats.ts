import type { PerkRef, StatGroupRef, StatGroupScaledStat, StatMod, WeaponDoc, WeaponStat } from "./types";

/** Linear 1:1 stat group used by sample fixtures and unit tests. */
export const SAMPLE_STAT_GROUP_HASH = 99_999;

/** Bungie stat hash for the Ammo Generation weapon stat. */
export const AMMO_GENERATION_STAT_HASH = 1_931_675_084;

export const sampleStatGroup: StatGroupRef = {
  hash: SAMPLE_STAT_GROUP_HASH,
  maximumValue: 100,
  scaledStats: [
    {
      statHash: 1,
      maximumValue: 100,
      displayInterpolation: [
        { value: 0, weight: 0 },
        { value: 100, weight: 100 },
      ],
    },
    {
      statHash: 2,
      maximumValue: 100,
      displayInterpolation: [
        { value: 0, weight: 0 },
        { value: 100, weight: 100 },
      ],
    },
    {
      statHash: 3,
      maximumValue: 100,
      displayInterpolation: [
        { value: 0, weight: 0 },
        { value: 100, weight: 100 },
      ],
    },
    {
      statHash: 4,
      maximumValue: 100,
      displayInterpolation: [
        { value: 0, weight: 0 },
        { value: 100, weight: 100 },
      ],
    },
  ],
};

/** Banker's rounding — matches in-game stat display for most weapon stats. */
function bankersRound(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - Math.floor(x)) !== 0.5) return r;
  return r % 2 === 0 ? r : Math.floor(x);
}

/** Transform an investment stat into a display stat via stat-group interpolation. */
export function interpolateStatValue(
  investmentValue: number,
  statDisplay: StatGroupScaledStat,
): number {
  const interp = statDisplay.displayInterpolation;
  if (interp.length === 0) return investmentValue;

  const value = Math.min(investmentValue, statDisplay.maximumValue);

  let endIndex = interp.findIndex((point) => point.value > value);
  if (endIndex < 0) endIndex = interp.length - 1;
  const startIndex = Math.max(0, endIndex - 1);

  const start = interp[startIndex]!;
  const end = interp[endIndex]!;
  const range = end.value - start.value;
  if (range === 0) return start.weight;

  const t = (value - start.value) / range;
  const interpValue = start.weight + t * (end.weight - start.weight);

  // Magazine (hash 3871231066) uses standard round; everything else uses banker's round.
  return statDisplay.statHash === 3_871_231_066
    ? Math.round(interpValue)
    : bankersRound(interpValue);
}

/** Merge investment stat maps by stat hash. */
export function sumInvestmentStats(
  base: WeaponStat[],
  ...modLists: StatMod[][]
): Map<number, { name: string; value: number }> {
  const merged = new Map<number, { name: string; value: number }>();
  for (const stat of base) {
    merged.set(stat.hash, { name: stat.name, value: stat.value });
  }
  for (const mods of modLists) {
    for (const mod of mods) {
      const existing = merged.get(mod.hash);
      if (existing) {
        existing.value += mod.value;
      } else {
        merged.set(mod.hash, { name: `Stat ${mod.hash}`, value: mod.value });
      }
    }
  }
  return merged;
}

/** Scale merged investment stats into display stats using a stat group. */
export function scaleInvestmentStats(
  investmentByHash: Map<number, { name: string; value: number }>,
  statGroup: StatGroupRef | undefined,
): WeaponStat[] {
  const scaledByHash = new Map<number, WeaponStat>();

  for (const [hash, { name, value }] of investmentByHash) {
    const statDisplay = statGroup?.scaledStats.find((s) => s.statHash === hash);
    const displayValue = statDisplay
      ? interpolateStatValue(value, statDisplay)
      : Math.min(value, statGroup?.maximumValue ?? value);
    scaledByHash.set(hash, { hash, name, value: displayValue });
  }

  // Preserve stat order from investment map; append any scaled-only stats.
  return [...scaledByHash.values()];
}

function collectStatMods(perks: PerkRef[]): StatMod[] {
  const mods: StatMod[] = [];
  for (const perk of perks) {
    if (perk.statMods) mods.push(...perk.statMods);
  }
  return mods;
}

export interface ComputedWeaponStats {
  /** Display stats with selected perks applied. */
  stats: WeaponStat[];
  /** Base display stats (no optional perks selected). */
  baseStats: WeaponStat[];
}

/**
 * Compute weapon display stats from base investment stats + selected perk mods.
 * Falls back to weapon.stats when investment data or stat group is unavailable.
 */
export function computeWeaponStats(
  weapon: WeaponDoc,
  selectedPerkHashes: readonly number[],
  statGroups: Record<string, StatGroupRef> | undefined,
  extraStatMods: readonly StatMod[] = [],
): ComputedWeaponStats {
  const fallbackBase = weapon.stats;
  const investmentStats = weapon.investmentStats;
  const statGroup =
    weapon.statGroupHash != null ? statGroups?.[String(weapon.statGroupHash)] : undefined;

  if (!investmentStats?.length || !statGroup) {
    return { stats: fallbackBase, baseStats: fallbackBase };
  }

  const perkByHash = new Map<number, PerkRef>();
  for (const column of weapon.columns) {
    for (const perk of column.perks) {
      perkByHash.set(perk.hash, perk);
      for (const alt of perk.alternateHashes ?? []) perkByHash.set(alt, perk);
    }
  }

  const selectedPerks = selectedPerkHashes
    .map((hash) => perkByHash.get(hash))
    .filter((perk): perk is PerkRef => perk != null);

  const baseInvestment = sumInvestmentStats(investmentStats);
  const withPerksInvestment = sumInvestmentStats(
    investmentStats,
    collectStatMods(selectedPerks),
    [...extraStatMods],
  );

  const baseDisplay = scaleInvestmentStats(baseInvestment, statGroup);
  const computedDisplay = scaleInvestmentStats(withPerksInvestment, statGroup);

  const order = fallbackBase.map((s) => s.hash);
  const sortByWeaponOrder = (list: WeaponStat[]) => {
    const byHash = new Map(list.map((s) => [s.hash, s]));
    const ordered = order
      .map((hash) => byHash.get(hash))
      .filter((s): s is WeaponStat => s != null);
    for (const stat of list) {
      if (!order.includes(stat.hash)) ordered.push(stat);
    }
    return ordered;
  };

  return {
    baseStats: sortByWeaponOrder(baseDisplay),
    stats: sortByWeaponOrder(computedDisplay),
  };
}
