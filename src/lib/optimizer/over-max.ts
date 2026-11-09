// Why a search found nothing, when one target alone is to blame. Pure, for the stat rows
// and the empty builds message alike, so the two can never disagree.
import type { OptimizerOutput } from "./types";

/** A target past its maximum; lowering it to `max` alone brings builds back. */
export interface OverMaxCulprit {
  /** Stat index in canonical order (see StatArray). */
  stat: number;
  max: number;
  /** The max is proven exact; otherwise it is achievable but possibly higher ("at least"). */
  proven: boolean;
}

/** What each stat row shows while nothing matches. */
export type EmptyStatState = "over" | "none";

/**
 * Culprits of an EMPTY result for `targets` (the targets it was searched for). A stat's
 * maximum ignores its own target (it is the best that stat reaches with the OTHER five
 * targets met), so a target above a maximum greater than 0 is one the player can lower
 * to that maximum and get builds: a build reaching it exists by construction. A maximum
 * of 0 says the other targets can't be met at all, so that stat is not a culprit.
 */
export function overMaxCulprits(result: OptimizerOutput, targets: readonly number[]): OverMaxCulprit[] {
  if (result.loadouts.length > 0) return [];
  const culprits: OverMaxCulprit[] = [];
  for (let s = 0; s < result.ceilings.length; s++) {
    const max = result.ceilings[s];
    if (max > 0 && targets[s] > max) {
      culprits.push({ stat: s, max, proven: max === result.ceilingUppers[s] });
    }
  }
  return culprits;
}

/** Per-stat row state for an empty result: culprits read "over", stats with no max "none". */
export function emptyStatStates(
  result: OptimizerOutput,
  culprits: readonly OverMaxCulprit[],
): (EmptyStatState | undefined)[] {
  return result.ceilings.map((max, s) =>
    culprits.some((c) => c.stat === s) ? "over" : max === 0 ? "none" : undefined,
  );
}
