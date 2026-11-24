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

/**
 * A weapon's masterworks, as the Popularity card lists them: every one the
 * weapon can take, in the Masterworks section's order, with its share of the
 * copies whose masterwork is known.
 */
export interface MasterworkPopularity {
  /** The masterwork slot's key in picks (masterworkSlotKey). */
  slot: number;
  /** Copies whose masterwork is known: the shares' denominator, which can be fewer than the weapon's copies. */
  counted: number;
  perks: PerkPopularity[];
}

/**
 * The fewest copies with a known masterwork for the card to show their shares
 * (and the roll to take the top one): masterworks are counted only on copies
 * read since they were kept, so for a while after that began even a popular
 * weapon has a handful, and a share of a handful reads as a fact.
 */
export const MIN_MASTERWORK_COPIES = 30;

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
  /** Distinct copies counted (see WeaponPopularity.copies). */
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
  /** Undefined when the weapon has no masterworks to pick. */
  masterworks?: MasterworkPopularity;
  /** The roll to try, keyed like picks (by column): see mostPopularRoll. */
  topRoll: Roll;
}

/**
 * The roll "Try most popular roll" picks: the most run perk in each column
 * (the first of any tie, in grid order), except the two trait columns, which
 * take the most run combo (ties also in grid order), so the traits picked were
 * seen together. Only a combo seen at least MIN_COMBO_COUNT times replaces the
 * columns' own winners: on a thin sample one or two copies shouldn't
 * override a column's clear lead. The most run masterwork (the first of any
 * tie, in the section's order) goes in too, once MIN_MASTERWORK_COPIES copies
 * have one known.
 */
/** The fewest copies with a combo for it to set the roll's traits. */
export const MIN_COMBO_COUNT = 3;

export function mostPopularRoll(
  columns: WeaponPopularityView["columns"],
  combos: readonly ComboPopularity[],
  masterworks?: MasterworkPopularity,
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
  if (masterworks && masterworks.counted >= MIN_MASTERWORK_COPIES && masterworks.perks.length > 0)
    roll[masterworks.slot] = masterworks.perks.reduce((best, p) => (p.share > best.share ? p : best)).perkIndex;
  return roll;
}
