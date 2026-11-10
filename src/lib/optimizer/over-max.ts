// Why a search found nothing, when one target alone is to blame. Pure and in one place,
// for the stat rows, the empty builds message and its copy alike, so they can't disagree.
import type { ShownResult } from "./optimizer-store";
import type { BuildList, OptimizerOutput, RefinementState } from "./types";

/** A target past its maximum; lowering it to `max` alone brings builds back. */
export interface OverMaxCulprit {
  /** Stat index in canonical order (see StatArray). */
  stat: number;
  max: number;
  /** The max is proven exact; otherwise it is achievable but possibly higher ("at least"). */
  proven: boolean;
}

/**
 * What a stat row shows while nothing matches: "over" marks its target as past its max
 * (and carries that max, so the row reads the same number the message names), "none"
 * means the other targets leave this stat no max at all.
 */
export type EmptyStatState = { kind: "over"; max: number } | { kind: "none" };

/** The page's over-max state: who is to blame, and what each stat row shows. */
export interface OverMaxState {
  culprits: OverMaxCulprit[];
  /** Per stat in canonical order; undefined for a stat that is neither. */
  rows: (EmptyStatState | undefined)[];
}

/**
 * An empty list that is settled and proven: no background pass is still running, no
 * better list is waiting behind "Show them", and the walk behind it ran to exhaustion
 * (in line, or the background re-run did). Only then is "nothing meets these targets" a
 * fact. A capped walk proved nothing: "none found in time", never "none exist".
 */
export function isSettledEmpty(result: BuildList, refinement: RefinementState): boolean {
  if (result.loadouts.length > 0) return false;
  if (refinement.phase === "running") return false;
  if (refinement.phase === "done" && refinement.pending) return false;
  return !result.capped || (refinement.phase === "done" && refinement.verified);
}

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

/**
 * The over-max state for the result on screen, or null when there is nothing to mark.
 * Read only from a FINAL, settled empty result (isSettledEmpty) that was searched for
 * the class and targets on screen: never from maximums still streaming in, so a row
 * can't be marked on a search that has builds, and the Set buttons can't name a maximum
 * the bars have already passed. A search in flight or a crashed one marks nothing.
 */
export function overMaxState({
  shown,
  refinement,
  running,
  failed,
  classType,
  targets,
}: {
  shown: ShownResult | null;
  refinement: RefinementState;
  running: boolean;
  failed: boolean;
  classType: number | null;
  targets: readonly number[];
}): OverMaxState | null {
  if (running || failed || !shown || !shown.final) return null;
  const { result, origin } = shown;
  if (!isSettledEmpty(result, refinement)) return null;
  if (origin.classType !== (classType ?? undefined)) return null;
  if (origin.targets.some((v, s) => v !== targets[s])) return null;
  const culprits = overMaxCulprits(result, targets);
  const rows = result.ceilings.map((max, s): EmptyStatState | undefined => {
    const culprit = culprits.find((c) => c.stat === s);
    if (culprit) return { kind: "over", max: culprit.max };
    return max === 0 ? { kind: "none" } : undefined;
  });
  return { culprits, rows };
}
