/**
 * Weapon-power suggestions for the power range: which mix of weapon powers lets the
 * best build land in range. Weapons are three of the eight items the game averages, so
 * their powers decide how high the armor may sit — low weapons leave room for
 * high-power (usually better-rolled) armor, high weapons pull the armor down. Rather
 * than guess, try every mix of the common weapon powers against the real query (stats,
 * exotic, sets) and rank the mixes by the best build each one allows.
 *
 * Pure: runs in its own worker (weapon-plan-worker.ts) and under vitest.
 */
import { solve } from "./solve";
import type { OptimizerInput } from "./types";

/** The weapon powers most players have lying around: a 10, a 300, and a 550. */
export const COMMON_WEAPON_POWERS: readonly number[] = [10, 300, 550];
/** Kinetic, energy, heavy. */
const WEAPON_SLOT_COUNT = 3;
/** Search budget per mix — ten mixes, so the whole scan stays a few seconds at worst. */
const MIX_BUDGET_MS = 400;

export interface WeaponMixResult {
  /** Weapon powers, ascending (slot order doesn't move the average). */
  weapons: number[];
  /** Stat total of the best build this mix lets land in range. */
  best: number;
  /** The search hit its budget, so `best` is a lower bound. */
  capped: boolean;
}

/** Every multiset of `count` powers from `tiers`, each ascending, in lexicographic order. */
export function weaponMixes(
  tiers: readonly number[] = COMMON_WEAPON_POWERS,
  count = WEAPON_SLOT_COUNT,
): number[][] {
  const sorted = [...new Set(tiers)].sort((a, b) => a - b);
  const out: number[][] = [];
  const walk = (from: number, mix: number[]) => {
    if (mix.length === count) {
      out.push(mix);
      return;
    }
    for (let i = from; i < sorted.length; i++) walk(i, [...mix, sorted[i]]);
  };
  walk(0, []);
  return out;
}

/**
 * Solve `input` once per weapon mix (its own `powerRange.weapons` are ignored) and keep
 * the mixes that land any build in range. Null when the input has no power range.
 * Unranked — see rankWeaponMixes, which also weighs the weapons already entered.
 */
export function planWeapons(
  input: OptimizerInput,
  tiers: readonly number[] = COMMON_WEAPON_POWERS,
  budgetMs = MIX_BUDGET_MS,
): WeaponMixResult[] | null {
  const range = input.powerRange;
  if (!range) return null;
  const results: WeaponMixResult[] = [];
  for (const weapons of weaponMixes(tiers)) {
    const out = solve(
      { ...input, powerRange: { min: range.min, max: range.max, weapons }, maxResults: 1 },
      { topNBudgetMs: budgetMs, ceilingBudgetMs: 0 },
    );
    const top = out.loadouts[0];
    if (top) results.push({ weapons, best: top.total, capped: out.capped });
  }
  return results;
}

/** How many of `mix`'s powers the entered weapons already cover. */
function overlap(mix: readonly number[], entered: readonly (number | null)[]): number {
  const left = entered.filter((w): w is number => w !== null);
  let n = 0;
  for (const w of mix) {
    const i = left.indexOf(w);
    if (i >= 0) {
      left.splice(i, 1);
      n++;
    }
  }
  return n;
}

/**
 * Best mix first: highest best-build total, then the mix that changes the fewest of the
 * weapons already entered, then the lower weapons (more room for the armor).
 */
export function rankWeaponMixes(
  results: readonly WeaponMixResult[],
  entered: readonly (number | null)[],
): WeaponMixResult[] {
  const sum = (ws: readonly number[]) => ws.reduce((a, b) => a + b, 0);
  return [...results].sort(
    (a, b) =>
      b.best - a.best ||
      overlap(b.weapons, entered) - overlap(a.weapons, entered) ||
      sum(a.weapons) - sum(b.weapons),
  );
}

/**
 * Put `mix` into the weapon slots, leaving a slot alone where its entered power is part
 * of the mix — so a weapon the player already picked keeps its slot.
 */
export function assignWeaponMix(
  entered: readonly (number | null)[],
  mix: readonly number[],
): (number | null)[] {
  const left = [...mix];
  const next: (number | null)[] = entered.map((w) => {
    if (w === null) return null;
    const i = left.indexOf(w);
    if (i < 0) return null;
    left.splice(i, 1);
    return w;
  });
  return next.map((w) => w ?? left.shift() ?? null);
}

/** Whether the entered weapons are exactly `mix` (in any slot order). */
export function isCurrentMix(
  entered: readonly (number | null)[],
  mix: readonly number[],
): boolean {
  return (
    entered.every((w) => w !== null) &&
    entered.length === mix.length &&
    overlap(mix, entered) === mix.length
  );
}
