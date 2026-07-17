// Import from the leaf floors.ts (not ./solve or ./tuning): keeps the whole solver + tuner
// out of the main-thread bundle that pulls in carryover.ts (see use-optimizer.ts).
import { NUM_STATS, raiseAchievableFloors } from "./floors";
import type {
  CeilingCarry,
  ExoticConstraint,
  ModBudget,
  OptimizerInput,
  OptimizerPiece,
  OptimizerOutput,
  PieceTuning,
  SetRequirement,
} from "./types";

export type { CeilingCarry };

/**
 * Compile-time exhaustiveness pins for every type the same-query comparator walks
 * field-by-field. Each `satisfies Record<keyof T, true>` fails to compile the moment a
 * field is added to `T` without being listed here, forcing whoever adds it to decide how it
 * affects query identity. Without these, a new field on any nested type would compile clean,
 * compare "equal", and let the carry silently reuse ceilings from a genuinely different
 * query — corrupting the reported per-stat maxima. The top-level `OptimizerInput` witness is
 * `HANDLED_INPUT_KEYS` below; these cover the nested types it recurses into.
 */
const HANDLED_PIECE_KEYS = {
  id: true,
  stats: true,
  exotic: true,
  hash: true,
  setHash: true,
  tuning: true,
  artifice: true,
} satisfies Record<keyof OptimizerPiece, true>;
void HANDLED_PIECE_KEYS;

const HANDLED_TUNING_KEYS = {
  tuned: true,
  offStats: true,
} satisfies Record<keyof PieceTuning, true>;
void HANDLED_TUNING_KEYS;

const HANDLED_EXOTIC_KEYS = {
  mode: true,
  hashes: true,
} satisfies Record<keyof ExoticConstraint, true>;
void HANDLED_EXOTIC_KEYS;

const HANDLED_SET_REQ_KEYS = {
  setHash: true,
  count: true,
} satisfies Record<keyof SetRequirement, true>;
void HANDLED_SET_REQ_KEYS;

const HANDLED_MOD_BUDGET_KEYS = {
  major: true,
  minor: true,
} satisfies Record<keyof ModBudget, true>;
void HANDLED_MOD_BUDGET_KEYS;

/** Default the solver applies to `mods` (see solve.ts). */
function normMods(mods: ModBudget | undefined): ModBudget {
  return mods ?? { major: 0, minor: 0 };
}

/** Default the solver applies to `exotic.mode` (see solve.ts: `input.exotic?.mode ?? "any"`). */
function normExotic(exotic: ExoticConstraint | undefined): {
  mode: string;
  hashes: number[];
} {
  return {
    mode: exotic?.mode ?? "any",
    // Only "specific" reads `hashes`; normalize the rest to [] so they compare equal
    // regardless of a stray hashes array the solver would ignore.
    hashes: exotic?.mode === "specific" ? [...(exotic.hashes ?? [])] : [],
  };
}

function numArrayEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Compare fragmentBonus, applying the solver's `?? zeros` default to either side. */
function fragEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  const za = a ?? new Array(NUM_STATS).fill(0);
  const zb = b ?? new Array(NUM_STATS).fill(0);
  return numArrayEqual(za, zb);
}

/** Order-insensitive compare by (setHash, count); solver treats reqs as an unordered set. */
function setReqsEqual(
  a: SetRequirement[] | undefined,
  b: SetRequirement[] | undefined,
): boolean {
  const ra = a ?? [];
  const rb = b ?? [];
  if (ra.length !== rb.length) return false;
  const key = (r: SetRequirement) => `${r.setHash}:${r.count}`;
  const sa = ra.map(key).sort();
  const sb = rb.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Structural equality of two candidate pieces (stats gets a reference fast path). */
function pieceEqual(a: OptimizerPiece, b: OptimizerPiece): boolean {
  if (a.id !== b.id) return false;
  if (a.exotic !== b.exotic) return false;
  if (a.hash !== b.hash) return false;
  if (a.setHash !== b.setHash) return false;
  // builder-panel rebuilds piece objects every run but reuses the per-piece stats array
  // reference (it comes from a memoized pool), so this fast path skips the elementwise
  // walk on the common no-pool-change edit.
  if (a.stats !== b.stats && !numArrayEqual(a.stats, b.stats)) return false;
  // `artifice` is an optional boolean; undefined and false both mean "no artifice" to the
  // solver, so compare their booleanized forms.
  if (Boolean(a.artifice) !== Boolean(b.artifice)) return false;
  const at = a.tuning;
  const bt = b.tuning;
  if ((at === undefined) !== (bt === undefined)) return false;
  if (at && bt) {
    if (at.tuned !== bt.tuned) return false;
    if (!numArrayEqual(at.offStats, bt.offStats)) return false;
  }
  return true;
}

function slotsEqual(a: OptimizerPiece[][], b: OptimizerPiece[][]): boolean {
  if (a.length !== b.length) return false;
  for (let s = 0; s < a.length; s++) {
    const pa = a[s];
    const pb = b[s];
    if (pa.length !== pb.length) return false;
    // Pieces are enumerated in a stable order (builder-panel's per-slot filter preserves
    // pool order), so a positional compare is sound; any reorder reads as "changed" and
    // conservatively kills the carry.
    for (let i = 0; i < pa.length; i++) {
      if (!pieceEqual(pa[i], pb[i])) return false;
    }
  }
  return true;
}

/**
 * Every `OptimizerInput` key the comparator below accounts for. `minimums` is the one
 * field allowed to differ (that's the whole point of the carry); every OTHER field must
 * match. The `satisfies` assertion pins this list to `keyof OptimizerInput` exactly — add a
 * field to `OptimizerInput` and this fails to compile until it's classified here, so a new
 * query dimension can never be silently ignored by the same-query check.
 */
const HANDLED_INPUT_KEYS = {
  minimums: true,
  slots: true,
  mods: true,
  setRequirements: true,
  exotic: true,
  allowTuning: true,
  allowBalancedTuning: true,
  fragmentBonus: true,
  maxResults: true,
} satisfies Record<keyof OptimizerInput, true>;
void HANDLED_INPUT_KEYS;

/**
 * True iff `a` and `b` are the SAME query up to their `minimums` — i.e. their ceilings
 * are drawn from the same feasible region shape and only the minimum constraints differ.
 * Everything else is compared with the solver's own defaults normalized in, so an edit
 * that leaves a field at its default (`mods` undefined vs `{major:0,minor:0}`, etc.) does
 * not spuriously break the carry.
 *
 * The full destructure below is deliberate, and the `HandledInputKey` witness above it
 * makes a future `OptimizerInput` field a COMPILE error: adding a field without listing it
 * in `HANDLED_INPUT_KEYS` (i.e. without deciding how it affects query identity) breaks the
 * `satisfies` check. A silent false-positive would poison the carried seeds and corrupt the
 * next query's ceilings, so this is enforced by the type system, not by review discipline.
 */
export function sameQueryExceptMinimums(a: OptimizerInput, b: OptimizerInput): boolean {
  const {
    minimums: _aMin,
    slots: aSlots,
    mods: aMods,
    setRequirements: aReqs,
    exotic: aExotic,
    allowTuning: aTuning,
    allowBalancedTuning: aBalanced,
    fragmentBonus: aFrag,
    maxResults: aMax,
  } = a;
  const {
    minimums: _bMin,
    slots: bSlots,
    mods: bMods,
    setRequirements: bReqs,
    exotic: bExotic,
    allowTuning: bTuning,
    allowBalancedTuning: bBalanced,
    fragmentBonus: bFrag,
    maxResults: bMax,
  } = b;
  void _aMin;
  void _bMin;

  // allowTuning / allowBalancedTuning default to true (see bounds.ts); ?? true
  // normalizes both sides. The balanced flag only shapes the query while tuning is
  // on (buildTuneOpts ignores it otherwise), so with tuning off on both sides a
  // balanced difference must not spuriously kill the carry.
  const tuningOn = aTuning ?? true;
  if (tuningOn !== (bTuning ?? true)) return false;
  if (tuningOn && (aBalanced ?? true) !== (bBalanced ?? true)) return false;
  // maxResults defaults to DEFAULT_MAX_RESULTS (200).
  if ((aMax ?? 200) !== (bMax ?? 200)) return false;

  const ma = normMods(aMods);
  const mb = normMods(bMods);
  if (ma.major !== mb.major || ma.minor !== mb.minor) return false;

  const ea = normExotic(aExotic);
  const eb = normExotic(bExotic);
  if (ea.mode !== eb.mode || !numArrayEqual(ea.hashes, eb.hashes)) return false;

  if (!fragEqual(aFrag, bFrag)) return false;
  if (!setReqsEqual(aReqs, bReqs)) return false;
  if (!slotsEqual(aSlots, bSlots)) return false;

  return true;
}

type MinDirection = "equal" | "tightened" | "loosened" | "mixed";

/** Classify how `next` minimums relate to `prev` minimums, elementwise. */
function classifyMinimums(prev: number[], next: number[]): MinDirection {
  let anyUp = false;
  let anyDown = false;
  for (let s = 0; s < NUM_STATS; s++) {
    if (next[s] > prev[s]) anyUp = true;
    else if (next[s] < prev[s]) anyDown = true;
  }
  if (anyUp && anyDown) return "mixed";
  if (anyUp) return "tightened";
  if (anyDown) return "loosened";
  return "equal";
}

/**
 * Carry proven ceiling bounds from the previous query's result into the next solve, when
 * the next query differs from the previous ONLY in its minimums. Returns `undefined` when
 * nothing sound can be salvaged (different query, or a mixed min edit).
 *
 * Soundness of each branch — ceilings are the max of a stat over the feasible region cut
 * out by the OTHER five minimums, so tightening a min shrinks that region and loosening
 * grows it:
 *
 *  - EQUAL: identical query, identical answer. Both prior seeds transfer verbatim — the
 *    achievable lows are still achievable and the proven uppers are still proven.
 *
 *  - TIGHTENED (every new min ≥ old, ≥1 strictly greater): the feasible region SHRANK, so
 *    every stat's true max can only fall or hold. A proven UPPER bound from the larger
 *    region therefore still bounds the smaller region's max → `ceilingUpperSeed` carries.
 *    The old achievable lows may no longer be legal (a build could violate a raised min),
 *    so we DON'T carry `prev.ceilings`; instead we re-derive lows arithmetically from the
 *    stored loadouts: any loadout whose recorded final `stats` still meets EVERY new
 *    minimum is a legal build in the shrunk region (pure re-check, no search), and
 *    `raiseAchievableFloors` turns each survivor into a per-stat achievable-low seed. Omit
 *    `ceilingSeed` entirely if no stored loadout survives.
 *
 *  - LOOSENED (every new min ≤ old, ≥1 strictly smaller): the feasible region GREW, so
 *    every stat's true max can only rise or hold. The old achievable lows are still
 *    achievable (a build legal under stricter mins is legal under looser ones) →
 *    `ceilingSeed = prev.ceilings` carries. The old UPPER bounds no longer bound the
 *    larger region (its max may exceed them), so uppers are dropped.
 *
 *  - MIXED (some mins up, some down): the region neither contains nor is contained by the
 *    old one, and a per-stat ceiling depends on ALL the other mins jointly — no per-stat
 *    upper OR lower salvage is sound. Return `undefined` and let the next query solve cold.
 */
export function computeCeilingCarry(
  prevInput: OptimizerInput,
  prevOutput: OptimizerOutput,
  nextInput: OptimizerInput,
): CeilingCarry | undefined {
  if (!sameQueryExceptMinimums(prevInput, nextInput)) return undefined;

  // classifyMinimums (and the tightened re-derivation) index [0..NUM_STATS) blindly; a short
  // array reads `undefined`, every comparison is false, and it degrades to "equal" — which
  // carries BOTH seeds off a malformed query. Carry nothing on doubt.
  if (
    prevInput.minimums.length !== NUM_STATS ||
    nextInput.minimums.length !== NUM_STATS
  ) {
    return undefined;
  }

  const dir = classifyMinimums(prevInput.minimums, nextInput.minimums);

  if (dir === "mixed") return undefined;

  if (dir === "equal") {
    return {
      ceilingSeed: prevOutput.ceilings,
      ceilingUpperSeed: prevOutput.ceilingUppers,
    };
  }

  if (dir === "loosened") {
    // Old achievable lows survive; old proven uppers do not.
    return { ceilingSeed: prevOutput.ceilings };
  }

  // TIGHTENED: uppers stay proven; re-derive lows from surviving stored loadouts.
  const nextMins = nextInput.minimums;
  const mods = normMods(nextInput.mods); // same as prev — only mins changed
  const seed = new Array(NUM_STATS).fill(0);
  let anySurvivor = false;
  for (const lo of prevOutput.loadouts) {
    // A survivor is a build whose recorded final stats meet every NEW minimum — still a
    // legal loadout in the tightened region, verified by arithmetic alone.
    let survives = true;
    for (let s = 0; s < NUM_STATS; s++) {
      if (lo.stats[s] < nextMins[s]) {
        survives = false;
        break;
      }
    }
    if (!survives) continue;
    anySurvivor = true;
    raiseAchievableFloors(seed, lo.stats, lo.modsUsed, mods);
  }

  const carry: CeilingCarry = { ceilingUpperSeed: prevOutput.ceilingUppers };
  if (anySurvivor) carry.ceilingSeed = seed;
  return carry;
}
