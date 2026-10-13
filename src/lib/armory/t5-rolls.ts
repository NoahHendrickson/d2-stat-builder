/**
 * Every masterworked Tier-5 roll an archetype can drop: primary 30, secondary 25, the
 * tertiary 20, and MW5 lifting the three off-archetype stats to 5. The one table Dream
 * build and Theoretical Builds both farm from.
 *
 * Runtime imports are relative (not `@/`): the optimizer workers and Node tests use it.
 */
import type { ArmorArchetype } from "./archetypes";

const NUM_STATS = 6;

/** Tier-5 archetype stat values: primary, secondary, tertiary. */
export const T5_PRIMARY = 30;
export const T5_SECONDARY = 25;
export const T5_TERTIARY = 20;
/** MW5 lifts each of the three off-archetype stats to 5. */
export const T5_MASTERWORKED_OFF_STAT = 5;

/** The stats an archetype's tertiary can be: any but its primary and secondary. */
export function tertiariesOf(a: { primary: number; secondary: number }): number[] {
  const out: number[] = [];
  for (let s = 0; s < NUM_STATS; s++) if (s !== a.primary && s !== a.secondary) out.push(s);
  return out;
}

/** A roll's masterworked stats. */
export function t5RollStats(primary: number, secondary: number, tertiary: number): number[] {
  const stats = new Array(NUM_STATS).fill(T5_MASTERWORKED_OFF_STAT);
  stats[primary] = T5_PRIMARY;
  stats[secondary] = T5_SECONDARY;
  stats[tertiary] = T5_TERTIARY;
  return stats;
}

/** Every (archetype, tertiary) roll with its masterworked stats. */
export function t5Rolls(
  archetypes: ArmorArchetype[],
): { archetype: ArmorArchetype; tertiary: number; stats: number[] }[] {
  return archetypes.flatMap((archetype) =>
    tertiariesOf(archetype).map((tertiary) => ({
      archetype,
      tertiary,
      stats: t5RollStats(archetype.primary, archetype.secondary, tertiary),
    })),
  );
}
