import type { WeaponPopularity } from "./perk-popularity";
import { masterworkSlotKey, type Roll } from "./pick-slots";
import type { WeaponSummary } from "./types";

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
 * A weapon's masterworks, as the Popularity card shows them, in the picks'
 * masterwork `slot` (masterworkSlotKey). `counted` is the copies whose
 * masterwork is known, one of the weapon's own: the shares' denominator. With
 * none counted, or too few to go on, there are no shares; otherwise every
 * masterwork the weapon can take, in the Masterworks section's order, its
 * share (0 for one no counted copy has), the most run (`top`, the first of
 * any tie), and whether the counted copies fall well short of the weapon's.
 */
export type MasterworkPopularity =
  | { state: "none"; slot: number }
  | { state: "few"; slot: number; counted: number }
  | { state: "shown"; slot: number; counted: number; perks: PerkPopularity[]; top: number; partial: boolean };

/**
 * The fewest copies with a known masterwork for their shares to show (and the
 * roll to take the top one): masterworks are counted only on copies read since
 * they were kept, so for a while after that began even a popular weapon has a
 * handful, and a share of a handful reads as a fact.
 */
export const MIN_MASTERWORK_COPIES = 30;

/** Below this part of the weapon's copies, a masterwork's shares are `partial`. */
const MOST_COPIES = 0.9;

/** A weapon's masterworks as the card shows them (see MasterworkPopularity); undefined when it has none to pick. */
export function masterworkPopularity(
  data: Pick<WeaponPopularity, "copies" | "masterworks">,
  weapon: Pick<WeaponSummary, "columns" | "masterworks">,
  perks: readonly ({ hash: number } | undefined)[],
): MasterworkPopularity | undefined {
  if (!weapon.masterworks?.length) return undefined;
  const slot = masterworkSlotKey(weapon);
  // Only the weapon's own count: one the catalog no longer lists can't be shown or picked.
  const counts = weapon.masterworks.map((perkIndex) => {
    const hash = perks[perkIndex]?.hash;
    return { perkIndex, count: hash === undefined ? 0 : (data.masterworks?.[hash] ?? 0) };
  });
  const counted = counts.reduce((sum, c) => sum + c.count, 0);
  if (counted === 0) return { state: "none", slot };
  if (counted < MIN_MASTERWORK_COPIES) return { state: "few", slot, counted };
  const shown = counts.map(({ perkIndex, count }) => ({ perkIndex, share: count / counted }));
  return {
    state: "shown",
    slot,
    counted,
    perks: shown,
    top: shown.reduce((best, p) => (p.share > best.share ? p : best)).perkIndex,
    partial: counted < data.copies * MOST_COPIES,
  };
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

/** The fewest copies with a combo for it to set the roll's traits. */
export const MIN_COMBO_COUNT = 3;

/**
 * The roll "Try most popular roll" picks: the most run perk in each column
 * (the first of any tie, in grid order), except the two trait columns, which
 * take the most run combo (ties also in grid order), so the traits picked were
 * seen together. Only a combo seen at least MIN_COMBO_COUNT times replaces the
 * columns' own winners: on a thin sample one or two copies shouldn't
 * override a column's clear lead. The top masterwork goes in too, when its
 * shares are shown.
 */
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
  if (masterworks?.state === "shown") roll[masterworks.slot] = masterworks.top;
  return roll;
}
