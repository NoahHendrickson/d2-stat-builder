// What gear power the builder can actually reach — drives the power range's default,
// slider span, and "nothing can land here" warning. Pure; runtime imports relative so it
// runs under vitest.

/**
 * Per-slot power extremes across the candidate armor, summed over the slots that have
 * any piece with a known power. `slots` is that slot count (5 in the normal case).
 */
export interface ArmorPowerSpan {
  minSum: number;
  maxSum: number;
  slots: number;
}

/** Sum the lowest and highest known power per slot; null when no slot has a known power. */
export function armorPowerSpan(
  slotPieces: readonly (readonly { power?: number }[])[],
): ArmorPowerSpan | null {
  let minSum = 0;
  let maxSum = 0;
  let slots = 0;
  for (const pieces of slotPieces) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pieces) {
      if (p.power === undefined) continue;
      if (p.power < lo) lo = p.power;
      if (p.power > hi) hi = p.power;
    }
    if (lo > hi) continue;
    minSum += lo;
    maxSum += hi;
    slots++;
  }
  return slots === 0 ? null : { minSum, maxSum, slots };
}

/**
 * The gear power a build can land on, given the weapons averaged in: the floored mean of
 * every slot's lowest (highest) piece plus the weapons. An optimistic span — exotic and
 * set-bonus limits can keep the extremes from combining — but the right scale for a
 * default range, unlike the single highest piece (which no five-piece average reaches).
 */
export function reachableGearPower(
  span: ArmorPowerSpan,
  weapons: readonly number[],
): { min: number; max: number } {
  let w = 0;
  for (const p of weapons) w += p;
  const n = span.slots + weapons.length;
  return {
    min: Math.floor((span.minSum + w) / n),
    max: Math.floor((span.maxSum + w) / n),
  };
}

/** First-enable default: the top five reachable levels, clamped to what's reachable at all. */
export function seedPowerRange(
  span: ArmorPowerSpan,
  weapons: readonly number[],
): { min: number; max: number } {
  const reach = reachableGearPower(span, weapons);
  return { min: Math.max(reach.min, reach.max - 5), max: reach.max };
}
