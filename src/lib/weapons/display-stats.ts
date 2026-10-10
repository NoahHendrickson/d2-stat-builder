import type { PerkRef, StatCurve, WeaponIndex, WeaponSummary } from "./types";

/** Round half to even, which is how the game rounds interpolated stats. */
function roundHalfEven(value: number) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) > 1e-9) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** An investment value on a stat group's display curve. */
export function interpolateStat(investment: number, curve: StatCurve) {
  const value = Math.min(Math.max(investment, 0), curve.max);
  const { points } = curve;
  const end = points.findIndex(([at]) => at > value);
  if (end < 0) return points[points.length - 1]![1];
  if (end === 0) return points[0]![1];
  const [fromValue, fromWeight] = points[end - 1]!;
  const [toValue, toWeight] = points[end]!;
  const t = (value - fromValue) / (toValue - fromValue);
  return roundHalfEven(fromWeight + t * (toWeight - fromWeight));
}

/**
 * A weapon's displayed stats with the given perks slotted: investment values plus
 * each perk's modifiers, run through the weapon's stat group. With no perks this
 * is the base the manifest lists.
 */
export function weaponDisplayStats(
  weapon: Pick<WeaponSummary, "statInvestment" | "statGroupHash">,
  statCurves: WeaponIndex["statCurves"],
  perks: readonly PerkRef[] = [],
): Record<string, number> {
  const curves =
    weapon.statGroupHash != null
      ? statCurves?.[String(weapon.statGroupHash)]
      : undefined;
  const display: Record<string, number> = {};
  for (const [name, base] of Object.entries(weapon.statInvestment ?? {})) {
    let investment = base;
    for (const perk of perks) investment += perk.stats?.[name] ?? 0;
    const curve = curves?.[name];
    display[name] = curve ? interpolateStat(investment, curve) : investment;
  }
  return display;
}
