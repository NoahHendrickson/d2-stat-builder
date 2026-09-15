// What gear power the builder can actually reach — drives the power range's default,
// slider span, and "nothing can land here" warning. Pure; runtime imports relative so it
// runs under vitest.

/** Lowest and highest known power among one kind of piece in a slot. */
export interface PowerExtremes {
  lo: number;
  hi: number;
}

/**
 * One slot's candidates, reduced to what the gear-power average can see: the extremes
 * of its legendaries and of its exotics (the solver allows at most one exotic per
 * loadout), and whether the slot offers a piece with NO known power — a theoretical roll
 * the solver leaves out of the mean entirely, so the slot can also contribute nothing.
 */
export interface SlotPowerSpan {
  legendary: PowerExtremes | null;
  exotic: PowerExtremes | null;
  excludable: boolean;
}

/** The slots that have at least one piece with a known power, in slot order. */
export type ArmorPowerSpan = readonly SlotPowerSpan[];

function extend(cur: PowerExtremes | null, power: number): PowerExtremes {
  if (cur === null) return { lo: power, hi: power };
  if (power < cur.lo) cur.lo = power;
  if (power > cur.hi) cur.hi = power;
  return cur;
}

/**
 * Reduce the candidate pool to per-slot power extremes. Slots with no known-power piece
 * at all are dropped (they can never move the mean); null when that leaves nothing.
 */
export function armorPowerSpan(
  slotPieces: readonly (readonly { power?: number; isExotic: boolean }[])[],
): ArmorPowerSpan | null {
  const span: SlotPowerSpan[] = [];
  for (const pieces of slotPieces) {
    let legendary: PowerExtremes | null = null;
    let exotic: PowerExtremes | null = null;
    let excludable = false;
    for (const p of pieces) {
      if (p.power === undefined) {
        excludable = true;
      } else if (p.isExotic) {
        exotic = extend(exotic, p.power);
      } else {
        legendary = extend(legendary, p.power);
      }
    }
    if (legendary === null && exotic === null) continue;
    span.push({ legendary, exotic, excludable });
  }
  return span.length === 0 ? null : span;
}

/**
 * The gear power a build can land on, given the weapons averaged in: the floored mean
 * over the pieces the solver would count plus the weapons, taken to its extremes. Walks
 * every way of filling the slots — each slot at its lowest / highest legendary, its
 * lowest / highest exotic, or (when it offers an unknown-power piece) left out of the
 * mean — under the solver's one-exotic rule. Still optimistic: set bonuses, a required
 * exotic, and the stat floors can keep the extremes from combining. Null when no filling
 * is possible (two slots that only offer exotics), or when the only filling counts
 * nothing at all — that loadout's power is null and passes any range, so there is no
 * span to report.
 */
export function reachableGearPower(
  span: ArmorPowerSpan,
  weapons: readonly number[],
): { min: number; max: number } | null {
  let weaponSum = 0;
  for (const p of weapons) weaponSum += p;
  let min = Infinity;
  let max = -Infinity;

  const walk = (
    k: number,
    exotics: number,
    loSum: number,
    hiSum: number,
    counted: number,
  ): void => {
    if (k === span.length) {
      const n = counted + weapons.length;
      if (n === 0) return;
      const lo = Math.floor((loSum + weaponSum) / n);
      const hi = Math.floor((hiSum + weaponSum) / n);
      if (lo < min) min = lo;
      if (hi > max) max = hi;
      return;
    }
    const slot = span[k];
    if (slot.legendary) {
      walk(k + 1, exotics, loSum + slot.legendary.lo, hiSum + slot.legendary.hi, counted + 1);
    }
    if (slot.exotic && exotics === 0) {
      walk(k + 1, 1, loSum + slot.exotic.lo, hiSum + slot.exotic.hi, counted + 1);
    }
    if (slot.excludable) walk(k + 1, exotics, loSum, hiSum, counted);
  };
  walk(0, 0, 0, 0, 0);

  return min <= max ? { min, max } : null;
}

/** First-enable default: the top five reachable levels, clamped to what's reachable at all. */
export function seedPowerRange(
  span: ArmorPowerSpan,
  weapons: readonly number[],
): { min: number; max: number } | null {
  const reach = reachableGearPower(span, weapons);
  return reach && { min: Math.max(reach.min, reach.max - 5), max: reach.max };
}
