// The highest gear power a character could equip from everything on the account (DIM's
// "max power"): the best item in each of the eight slots, with the game's limit of one
// exotic weapon and one exotic armor piece.
import { BUCKETS } from "./buckets";

const WEAPON_SLOTS = [BUCKETS.kinetic, BUCKETS.energy, BUCKETS.power];
const ARMOR_SLOTS = [BUCKETS.helmet, BUCKETS.arms, BUCKETS.chest, BUCKETS.legs, BUCKETS.classItem];
const TIER_EXOTIC = 6;
/** DestinyClass.Unknown: usable by every class. */
const ANY_CLASS = 3;

export interface PowerItem {
  bucketHash: number;
  classType: number;
  tierType: number;
  power?: number;
}

/**
 * Best total power for `slots` with at most one exotic among them. An empty slot counts
 * as 0, the way the game averages a missing piece.
 */
function bestSum(slots: readonly number[], items: readonly PowerItem[]): number {
  const best = new Map<number, number>();
  const bestLegendary = new Map<number, number>();
  for (const item of items) {
    if (item.power === undefined) continue;
    if (item.power > (best.get(item.bucketHash) ?? 0)) best.set(item.bucketHash, item.power);
    if (item.tierType !== TIER_EXOTIC && item.power > (bestLegendary.get(item.bucketHash) ?? 0)) {
      bestLegendary.set(item.bucketHash, item.power);
    }
  }
  const legendary = slots.reduce((sum, s) => sum + (bestLegendary.get(s) ?? 0), 0);
  // Spend the one exotic on whichever slot gains the most from it.
  let gain = 0;
  for (const s of slots) gain = Math.max(gain, (best.get(s) ?? 0) - (bestLegendary.get(s) ?? 0));
  return legendary + gain;
}

/**
 * Max gear power for a character of `classType`: floor of the mean of the best
 * weapons and armor it can use, or undefined when it has nothing with power.
 */
export function maxPower(items: readonly PowerItem[], classType: number): number | undefined {
  const usable = items.filter(
    (i) => i.power !== undefined && (i.classType === ANY_CLASS || i.classType === classType),
  );
  if (usable.length === 0) return undefined;
  const total = bestSum(WEAPON_SLOTS, usable) + bestSum(ARMOR_SLOTS, usable);
  return Math.floor(total / (WEAPON_SLOTS.length + ARMOR_SLOTS.length));
}
