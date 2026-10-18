import type { Roll } from "./pick-slots";

/**
 * Perk popularity as the weapon page shows it: one weapon's shares mapped onto
 * its catalog perks (useWeaponPopularity builds it), and the roll it suggests.
 */

/** One perk's share of its column, as the Popularity card lists it. */
export interface PerkPopularity {
  perkIndex: number;
  share: number;
}

/** One left + right combo, as the Popularity card lists it. */
export interface ComboPopularity {
  /** The trait columns and the catalog perk index in each. */
  leftColumn: number;
  left: number;
  rightColumn: number;
  right: number;
  /** Copies seen running both. */
  count: number;
  share: number;
}

export interface WeaponPopularityView {
  /** The snapshot has this weapon. */
  available: boolean;
  /** Copies seen used in PvE. */
  copies: number;
  /** When the snapshot was built. */
  generatedAt?: string;
  /**
   * Each perk column with data, every one of its perks in the grid's order (so
   * the card lines up with it), with its share; perks no one ran are 0.
   */
  columns: { column: number; perks: PerkPopularity[] }[];
  /** The most run left + right combos, most run first. */
  combos: ComboPopularity[];
  /** The roll to try, keyed like picks (by column): see mostPopularRoll. */
  topRoll: Roll;
}

/**
 * The roll "Try most popular roll" picks: the most run perk in each column
 * (the first of any tie, in grid order), except the two trait columns, which
 * take the most run combo (ties also in grid order), so the traits picked were
 * seen together. Only a combo seen at least MIN_COMBO_COUNT times replaces the
 * columns' own winners: on a thin sample one or two sightings shouldn't
 * override a column's clear lead.
 */
/** The fewest sightings of a combo for it to set the roll's traits. */
export const MIN_COMBO_COUNT = 3;

export function mostPopularRoll(
  columns: WeaponPopularityView["columns"],
  combos: readonly ComboPopularity[],
): Roll {
  const roll: Roll = {};
  for (const { column, perks } of columns)
    roll[column] = perks.reduce((best, p) => (p.share > best.share ? p : best)).perkIndex;
  // Where a perk sits in its column, for breaking ties the way the grid reads.
  const position = (column: number, perkIndex: number) =>
    columns.find((c) => c.column === column)?.perks.findIndex((p) => p.perkIndex === perkIndex) ?? -1;
  const before = (a: ComboPopularity, b: ComboPopularity) => {
    if (a.count !== b.count) return a.count > b.count;
    const left = position(a.leftColumn, a.left) - position(b.leftColumn, b.left);
    return left !== 0 ? left < 0 : position(a.rightColumn, a.right) < position(b.rightColumn, b.right);
  };
  const top = combos.reduce<ComboPopularity | undefined>((best, c) => (!best || before(c, best) ? c : best), undefined);
  if (top && top.count >= MIN_COMBO_COUNT) {
    roll[top.leftColumn] = top.left;
    roll[top.rightColumn] = top.right;
  }
  return roll;
}
