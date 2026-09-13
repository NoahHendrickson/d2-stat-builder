// Armor-energy bookkeeping shared by the apply planner and the mod picker, so both
// judge "does this mod fit" from the same baseline.

/**
 * Energy used by the sockets we DON'T manage (intrinsics, masterwork, anything not in
 * the piece's mod sockets): the live `energy.used` minus what the managed sockets'
 * current plugs cost. Zero when the piece has no energy data.
 */
export function baselineEnergy(
  energy: { used: number } | undefined,
  currentPlugs: Iterable<number | undefined>,
  costOf: (hash: number) => number,
): number {
  if (!energy) return 0;
  let managed = 0;
  for (const h of currentPlugs) if (h) managed += costOf(h);
  return Math.max(0, energy.used - managed);
}
