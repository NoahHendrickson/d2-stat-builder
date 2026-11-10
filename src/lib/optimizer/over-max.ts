// Why a search found nothing, when one target alone is to blame. Pure and in one place,
// for the stat rows, the empty builds message and its copy alike, so they can't disagree.
import { queryKey, type ShownResult } from "./optimizer-store";
import type { BuildList, OptimizerInput, OptimizerOutput, RefinementState } from "./types";

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
 * Read only from a FINAL, settled empty result (isSettledEmpty) for the very query on
 * screen (`input`, compared by its whole key: targets, class, power range, sets and the
 * rest): never from maximums still streaming in, and never from a result an edit has
 * already moved on from, even while that edit's search is still waiting out a debounce.
 * So a row can't be marked on a search that has builds, and a Set button can't offer a
 * maximum computed for other settings. A search in flight or a crashed one marks nothing.
 */
export function overMaxState({
  shown,
  refinement,
  running,
  failed,
  input,
}: {
  shown: ShownResult | null;
  refinement: RefinementState;
  running: boolean;
  failed: boolean;
  /** The query the builder would search right now; null while it has none. */
  input: OptimizerInput | null;
}): OverMaxState | null {
  if (running || failed || !input || !shown || !shown.final) return null;
  const { result } = shown;
  if (!isSettledEmpty(result, refinement)) return null;
  if (shown.key !== queryKey(input)) return null;
  const culprits = overMaxCulprits(result, input.minimums);
  const rows = result.ceilings.map((max, s): EmptyStatState | undefined => {
    const culprit = culprits.find((c) => c.stat === s);
    if (culprit) return { kind: "over", max: culprit.max };
    return max === 0 ? { kind: "none" } : undefined;
  });
  return { culprits, rows };
}
