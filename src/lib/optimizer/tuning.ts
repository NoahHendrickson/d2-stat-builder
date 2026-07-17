/**
 * The per-loadout tuning + mod search, shared by the top-N build search (maximize mode)
 * and the ceiling probes (feasible mode). These used to be two hand-mirrored copies in
 * solve.ts; a real bug (an over-reported grenade ceiling) came from them drifting, so the
 * search now exists exactly once.
 */
import type {
  AppliedTuning,
  ModBudget,
  OptimizerPiece,
  PieceTuning,
} from "./types";
// Relative import: this module runs in the worker AND in vitest, which has no "@/" alias.
import { ARTIFICE_MOD_BONUS } from "../armory/stats";
// The stat constants + clamp live in the leaf floors.ts so main-thread code can reach them
// without dragging the tuner into its bundle. Re-export here so existing `./tuning` importers
// keep working.
import { NUM_STATS, NUM_SLOTS, STAT_CAP, clamp } from "./floors";

export { NUM_STATS, NUM_SLOTS, STAT_CAP, clamp };

/** One tuning choice for a piece: its per-stat delta and what to record if picked. */
export interface TuneOption {
  vec: number[];
  applied: AppliedTuning | null;
}

export interface InternalPiece {
  id: string;
  stats: number[];
  exotic: boolean;
  hash?: number;
  setHash?: number;
  /** Artifice piece — contributes a free +3 any-stat mod to the loadout's budget. */
  artifice: boolean;
  total: number;
  /** Index of the rolled tuned stat (the +5 target), or -1 if the piece can't be tuned. */
  tuned: number;
  /** Tuning choices the optimizer may pick from (always ≥1 — the no-tune option). */
  tuneOpts: TuneOption[];
  /** Best positive tuning contribution reachable per stat (for admissible pruning). */
  tuneStatUpside: number[];
  /**
   * Best realizable total tuning contribution: the max over options of the sum of
   * positive vec components (directional = +5, Balanced = +3, no-tune = 0). Negative
   * components don't count against it — the 0-clamp can absorb them entirely.
   */
  tuneTotalUpside: number;
}

/**
 * Points needed to close deficit `d` in a joint-feasibility bound. Stat mods come in
 * 5-point grains, so the deficit rounds up — unless free artifice (+3) mods are
 * reachable, which break the grain; then the raw deficit is the only admissible bound.
 * Every joint prune (searcher, top-N, ceiling probes) must use this one definition.
 */
export const deficitPoints = (d: number, artificeReachable: boolean): number =>
  artificeReachable ? d : Math.ceil(d / 5) * 5;

/**
 * Pre-clamp shortfall of `have` against a stat minimum — the ONE definition of "how far
 * below its minimum is this stat". A zero minimum is always met: realized stats clamp
 * at ≥0, so even a negative pre-clamp value (directional −5 overshoot, negative
 * fragment bonuses) needs no mod points to reach it. Every deficit the solver derives
 * (leaf fast path, slow-path prune, slow-path leaf, both joint min checks) goes through
 * this rule; deriving one inline is how the scattered zero-min bug happened.
 */
export const minShortfall = (min: number, have: number): number =>
  min > 0 && have < min ? min - have : 0;

/**
 * The directional-branching policy: a piece's directional tunes are only worth
 * branching where the +5 can land on a short stat — a legendary's +5 goes only to its
 * rolled tuned stat, an exotic's flexible slot to any stat. One definition shared by
 * the leaf searcher (dynamic per-call shortfalls) and the pool-time total-upside bound
 * (static: only a stat with a positive minimum can ever be short), so the two
 * encodings of the policy cannot drift.
 */
export function directionalsBranchable(
  exotic: boolean,
  tuned: number,
  short: (s: number) => boolean,
): boolean {
  if (!exotic) return tuned >= 0 && short(tuned);
  for (let s = 0; s < NUM_STATS; s++) if (short(s)) return true;
  return false;
}

/**
 * Shared results for the overwhelmingly common zero-artifice leaf (every all-Tier-5
 * loadout hits assignMods/settleLeaf once per combo, so the zero path must stay
 * allocation-free). Consumers treat outcome arrays as immutable — never write into
 * these. (Worker results are structured-cloned before the UI sees them.)
 */
const ZERO_ARTIFICE_POINTS: number[] = [0, 0, 0, 0, 0, 0];
const NO_ARTIFICE_SLOTS: (number | null)[] = [null, null, null, null, null];

function statTotal(stats: number[]): number {
  let t = 0;
  for (let i = 0; i < NUM_STATS; i++) t += stats[i];
  return t;
}

/**
 * Every tuning option for a piece: no-tune only when it can't be tuned (or tuning is
 * off), else Balanced (+1 to each off-archetype stat) plus directionals (+5 to a tuned
 * stat, −5 to another). "No tune" is omitted for tunable pieces because Balanced weakly
 * dominates it (pure upside, no downside) — unless Balanced itself is disallowed
 * (`allowBalanced` false), in which case no-tune takes its place as the default option
 * the searcher enumerates first.
 *
 * Legendaries can only put the +5 on their one rolled tuned stat. Tier-5 EXOTICS have a
 * flexible tuning slot — their +5 can go to ANY stat — so we generate a directional for
 * every (+stat, −stat) pair.
 */
export function buildTuneOpts(
  tuning: PieceTuning | undefined,
  allow: boolean,
  isExotic: boolean,
  allowBalanced: boolean,
): TuneOption[] {
  if (!allow || !tuning) return [{ vec: [0, 0, 0, 0, 0, 0], applied: null }];
  const opts: TuneOption[] = [];
  if (allowBalanced) {
    const balanced = [0, 0, 0, 0, 0, 0];
    for (const s of tuning.offStats) balanced[s] += 1;
    opts.push({ vec: balanced, applied: { kind: "balanced" } });
  } else {
    opts.push({ vec: [0, 0, 0, 0, 0, 0], applied: null });
  }
  const plusStats = isExotic ? [0, 1, 2, 3, 4, 5] : [tuning.tuned];
  for (const plus of plusStats) {
    for (let j = 0; j < NUM_STATS; j++) {
      if (j === plus) continue;
      const vec = [0, 0, 0, 0, 0, 0];
      vec[plus] += 5;
      vec[j] -= 5;
      opts.push({ vec, applied: { kind: "directional", plus, minus: j } });
    }
  }
  return opts;
}

/**
 * Build the optimizer's internal piece representation (tune options + upside bounds).
 *
 * `mins` (the query's minimums, when known at pool-build time) tightens
 * `tuneTotalUpside`: the leaf searcher only ever branches a piece's directionals to
 * bridge a minimum-driven shortfall (`directionalsBranchable` — the same policy object
 * the searcher's `limit` uses). Directionals the searcher can never apply must not
 * inflate the top-N prune bound (the flat +5 credit costs real pruning power). Omitted
 * `mins` falls back to the conservative all-options credit, which is always admissible.
 */
export function makeInternalPiece(
  p: OptimizerPiece,
  allowTuning: boolean,
  allowBalanced: boolean,
  mins?: number[],
): InternalPiece {
  const tuneOpts = buildTuneOpts(p.tuning, allowTuning, p.exotic, allowBalanced);
  // Same policy as the searcher's directional branching, evaluated statically: a stat
  // can only ever be short if its minimum is positive. Omitted mins ⇒ conservative
  // (credit every option), which is always admissible.
  const dirReachable =
    mins === undefined ||
    directionalsBranchable(p.exotic, p.tuning ? p.tuning.tuned : -1, (s) => mins[s] > 0);
  const tuneStatUpside = new Array(NUM_STATS).fill(0);
  let tuneTotalUpside = 0;
  for (const opt of tuneOpts) {
    let optTotal = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      // Per-stat upside stays unconditioned: ceiling probes raise minimums past the
      // query's, so canReachMin/suffixUp must keep crediting every option's +5.
      if (opt.vec[s] > tuneStatUpside[s]) tuneStatUpside[s] = opt.vec[s];
      // Positive components only: a directional's −5 can be fully absorbed by the
      // 0-clamp (the minus stat is already ≤0 at the leaf), so a signed sum would
      // undercount its realizable gain and make the top-N prune bound inadmissible.
      if (opt.vec[s] > 0) optTotal += opt.vec[s];
    }
    if (opt.applied?.kind === "directional" && !dirReachable) continue;
    if (optTotal > tuneTotalUpside) tuneTotalUpside = optTotal;
  }
  return {
    id: p.id,
    stats: p.stats,
    exotic: p.exotic,
    hash: p.hash,
    setHash: p.setHash,
    artifice: p.artifice ?? false,
    total: statTotal(p.stats),
    tuned: allowTuning && p.tuning ? p.tuning.tuned : -1,
    tuneOpts,
    tuneStatUpside,
    tuneTotalUpside,
  };
}

/**
 * Cheapest assignment of major (+10) / minor (+5) stat mods — plus free artifice (+3)
 * mods from artifice pieces — covering every stat's deficit within the budgets.
 * Covering prefers majors, then minors, then artifice: an artifice mod left unspent
 * here is worth a full +3 to the maximize dump, while a stat mod left unspent is worth
 * nothing (mods are only ever socketed to cover targets). Returns per-stat mod points,
 * artifice points, and counts, or null if infeasible.
 */
export function assignMods(
  deficits: number[],
  maxMajor: number,
  maxMinor: number,
  maxArtifice = 0,
): {
  points: number[];
  usedMajor: number;
  usedMinor: number;
  artificePoints: number[];
  usedArtifice: number;
} | null {
  const major = new Array(NUM_STATS).fill(0);
  const minor = new Array(NUM_STATS).fill(0);

  // Zero-artifice recursion, kept as a separate loop shape on purpose: it runs once
  // per enumerated combo (the solver's hottest call), so it must cost exactly what it
  // did before artifice existed. The three-resource variant below is the same search
  // with the artifice dimension added — a fix to one covering rule belongs in BOTH.
  const rec2 = (s: number, majorsLeft: number, minorsLeft: number): boolean => {
    if (s === NUM_STATS) return true;
    const need = deficits[s];
    if (need <= 0) return rec2(s + 1, majorsLeft, minorsLeft);
    const maxA = Math.min(majorsLeft, Math.ceil(need / 10));
    for (let a = maxA; a >= 0; a--) {
      const remainder = need - a * 10;
      const b = remainder > 0 ? Math.ceil(remainder / 5) : 0;
      if (b > minorsLeft) continue;
      major[s] = a;
      minor[s] = b;
      if (rec2(s + 1, majorsLeft - a, minorsLeft - b)) return true;
    }
    major[s] = 0;
    minor[s] = 0;
    return false;
  };

  if (maxArtifice === 0) {
    if (!rec2(0, maxMajor, maxMinor)) return null;
    return {
      points: major.map((a, i) => a * 10 + minor[i] * 5),
      usedMajor: major.reduce((x, y) => x + y, 0),
      usedMinor: minor.reduce((x, y) => x + y, 0),
      artificePoints: ZERO_ARTIFICE_POINTS, // shared — treated as immutable
      usedArtifice: 0,
    };
  }

  const artifice = new Array(NUM_STATS).fill(0);
  const rec3 = (
    s: number,
    majorsLeft: number,
    minorsLeft: number,
    artLeft: number,
  ): boolean => {
    if (s === NUM_STATS) return true;
    const need = deficits[s];
    if (need <= 0) return rec3(s + 1, majorsLeft, minorsLeft, artLeft);
    const maxA = Math.min(majorsLeft, Math.ceil(need / 10));
    for (let a = maxA; a >= 0; a--) {
      const afterMajor = need - a * 10;
      const maxC = Math.min(
        artLeft,
        afterMajor > 0 ? Math.ceil(afterMajor / 3) : 0,
      );
      for (let c = 0; c <= maxC; c++) {
        const remainder = afterMajor - c * 3;
        const b = remainder > 0 ? Math.ceil(remainder / 5) : 0;
        if (b > minorsLeft) continue;
        major[s] = a;
        minor[s] = b;
        artifice[s] = c;
        if (rec3(s + 1, majorsLeft - a, minorsLeft - b, artLeft - c)) return true;
      }
    }
    major[s] = 0;
    minor[s] = 0;
    artifice[s] = 0;
    return false;
  };

  if (!rec3(0, maxMajor, maxMinor, maxArtifice)) return null;
  return {
    points: major.map((a, i) => a * 10 + minor[i] * 5),
    usedMajor: major.reduce((x, y) => x + y, 0),
    usedMinor: minor.reduce((x, y) => x + y, 0),
    artificePoints: artifice.map((c: number) => c * ARTIFICE_MOD_BONUS),
    usedArtifice: artifice.reduce((x: number, y: number) => x + y, 0),
  };
}

/**
 * maximize: find the highest-total feasible tuning + mod assignment.
 * feasible: stop at the FIRST feasible one (an existence probe — same nullability,
 * cheaper search).
 */
export type TuningMode = "maximize" | "feasible";

export interface TuningOutcome {
  total: number;
  stats: number[];
  tuningBonus: number[];
  applied: (AppliedTuning | null)[];
  modBonus: number[];
  modsUsed: { major: number; minor: number };
  /** Points each stat gained from artifice +3 mods (covering + maximize dump). */
  artificeBonus: number[];
  /** Per slot: the stat the piece's artifice +3 went to (null = not artifice / unspent). */
  artifice: (number | null)[];
}

/**
 * Pick the tuning (+ mods) for a full loadout. Model (confirmed with Noah): every
 * tunable piece takes Balanced (+1 to each off-archetype stat) as free upside, and a
 * directional tune (+5 tuned / −5 chosen) is spent only to bridge a minimum that
 * Balanced can't reach. So Balanced-everywhere is the answer whenever it already meets
 * the minimums (the common, O(pieces) case); only when it falls short is the directional
 * search run (branch-and-bound, Balanced enumerated first per piece). When Balanced
 * Tuning is disallowed (`allowBalancedTuning` false), tuneOpts[0] is the no-tune option
 * instead, and the same structure holds: untuned-everywhere unless a directional is
 * needed to bridge a minimum.
 *
 * The factory owns the search's scratch arrays, so a caller allocates them once and pays
 * nothing per leaf. `sum` is the chosen pieces' summed base stats; `mins` the per-stat
 * minimums to meet (the caller may mutate and re-call — probes do).
 */
export function createTuningSearcher(
  frag: number[],
  mods: ModBudget,
): (
  chosen: InternalPiece[],
  sum: number[],
  mins: number[],
  mode: TuningMode,
) => TuningOutcome | null {
  const maxModPoints = mods.major * 10 + mods.minor * 5;
  const aug = new Array(NUM_STATS).fill(0);
  const deficits = new Array(NUM_STATS).fill(0);
  // Which stats the fast path left short (so a directional that can feed one may help).
  const shortStat: boolean[] = new Array(NUM_STATS).fill(false);
  // Hoisted predicate for directionalsBranchable — no per-node closure allocation.
  const isShort = (s: number): boolean => shortStat[s];
  const curApplied: (AppliedTuning | null)[] = new Array(NUM_SLOTS).fill(null);
  const artificePoints = new Array(NUM_STATS).fill(0);
  // suffixUp[i][s] = max tuning upside to stat s reachable from chosen pieces i..4.
  const suffixUp: number[][] = Array.from({ length: NUM_SLOTS + 1 }, () =>
    new Array(NUM_STATS).fill(0),
  );

  interface Winner {
    total: number;
    modBonus: number[];
    usedMajor: number;
    usedMinor: number;
    applied: (AppliedTuning | null)[];
    tuningBonus: number[];
    artificeBonus: number[];
  }

  /**
   * Maximize-mode leftover dump: every unspent artifice mod is worth +3 to the total
   * (artifice is free and piece-intrinsic — it is always socketed in practice), so
   * dump each into the stat with the most headroom below the cap. Mutates `art`
   * in place; `base` is the stat value before artifice.
   */
  const dumpArtifice = (base: number[], art: number[], leftovers: number): void => {
    for (let n = 0; n < leftovers; n++) {
      let best = -1;
      let bestRoom = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const room = STAT_CAP - (base[s] + art[s]);
        if (room > bestRoom) {
          bestRoom = room;
          best = s;
        }
      }
      if (best < 0) return; // everything capped — stop dumping
      art[best] += ARTIFICE_MOD_BONUS;
    }
  };

  /** Per-slot artifice picks from the per-stat points: hand stats out to artifice pieces in slot order. */
  const artificeSlots = (
    chosen: InternalPiece[],
    art: number[],
  ): (number | null)[] => {
    // Nothing spent (the common zero-artifice leaf) — share, don't allocate.
    if (art === ZERO_ARTIFICE_POINTS) return NO_ARTIFICE_SLOTS;
    const queue: number[] = [];
    for (let s = 0; s < NUM_STATS; s++) {
      for (let n = 0; n < art[s] / ARTIFICE_MOD_BONUS; n++) queue.push(s);
    }
    if (queue.length === 0) return NO_ARTIFICE_SLOTS;
    return Array.from({ length: NUM_SLOTS }, (_, i) =>
      chosen[i].artifice && queue.length ? (queue.shift() as number) : null,
    );
  };

  const makeOutcome = (
    chosen: InternalPiece[],
    sum: number[],
    w: Winner,
  ): TuningOutcome => {
    const stats = new Array<number>(NUM_STATS);
    for (let s = 0; s < NUM_STATS; s++) {
      stats[s] = clamp(
        sum[s] + frag[s] + w.tuningBonus[s] + w.modBonus[s] + w.artificeBonus[s],
      );
    }
    return {
      total: w.total,
      stats,
      tuningBonus: w.tuningBonus,
      applied: w.applied,
      modBonus: w.modBonus,
      modsUsed: { major: w.usedMajor, minor: w.usedMinor },
      artificeBonus: w.artificeBonus,
      artifice: artificeSlots(chosen, w.artificeBonus),
    };
  };

  /**
   * Finish a leaf whose mods were assigned: record the covering artifice points into
   * the `artificePoints` scratch, dump leftovers in maximize mode, and return the
   * leaf's clamped total. Shared by the fast path and the slow-path leaf so
   * the two can't drift (this module exists because two copies of this search once did).
   */
  const settleLeaf = (
    asg: NonNullable<ReturnType<typeof assignMods>>,
    artCount: number,
    mode: TuningMode,
  ): number => {
    let total = 0;
    if (artCount === 0) {
      // The overwhelmingly common leaf (all-Tier-5 loadout): identical math to the
      // pre-artifice solver, nothing extra touched.
      for (let s = 0; s < NUM_STATS; s++) {
        total += clamp(aug[s] + asg.points[s]);
      }
      return total;
    }
    for (let s = 0; s < NUM_STATS; s++) artificePoints[s] = asg.artificePoints[s];
    if (mode === "maximize") {
      // `deficits` is dead once assignMods succeeded — reuse it as the dump's
      // clamp base (aug + assigned mod points).
      for (let s = 0; s < NUM_STATS; s++) deficits[s] = aug[s] + asg.points[s];
      dumpArtifice(deficits, artificePoints, artCount - asg.usedArtifice);
    }
    for (let s = 0; s < NUM_STATS; s++) {
      total += clamp(aug[s] + asg.points[s] + artificePoints[s]);
    }
    return total;
  };

  return (chosen, sum, mins, mode) => {
    let artCount = 0;
    for (let i = 0; i < NUM_SLOTS; i++) if (chosen[i].artifice) artCount++;
    const maxLeafPoints = maxModPoints + artCount * ARTIFICE_MOD_BONUS;
    // Fast path: each piece's default option (tuneOpts[0] — Balanced when allowed, else
    // the no-tune option). If that already clears the minimums, it's this loadout's best
    // tuning — return without touching directionals.
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const def = chosen[i].tuneOpts[0];
      curApplied[i] = def.applied;
      for (let s = 0; s < NUM_STATS; s++) aug[s] += def.vec[s];
    }
    for (let s = 0; s < NUM_STATS; s++) {
      deficits[s] = minShortfall(mins[s], aug[s]);
    }
    const balAsg = assignMods(deficits, mods.major, mods.minor, artCount);
    if (balAsg) {
      const tuningBonus = new Array<number>(NUM_STATS);
      for (let s = 0; s < NUM_STATS; s++) {
        tuningBonus[s] = aug[s] - sum[s] - frag[s];
      }
      return makeOutcome(chosen, sum, {
        total: settleLeaf(balAsg, artCount, mode),
        modBonus: balAsg.points.slice(),
        usedMajor: balAsg.usedMajor,
        usedMinor: balAsg.usedMinor,
        applied: curApplied.slice(),
        tuningBonus,
        // settleLeaf leaves the artifice scratch untouched on the zero path — share.
        artificeBonus:
          artCount === 0 ? ZERO_ARTIFICE_POINTS : artificePoints.slice(),
      });
    }

    // Slow path: the default option falls short of a minimum — branch the directional
    // tunes. `deficits` still holds the fast path's shortfall: a directional only helps
    // a short stat.
    for (let s = 0; s < NUM_STATS; s++) shortStat[s] = deficits[s] > 0;
    // Reset the fast path's accumulation: rec() re-adds every piece's tuning (the
    // default option is tuneOpts[0]), so aug must restart at sum+frag or it would be
    // double-counted (the exact drift bug that once over-reported a ceiling).
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let s = 0; s < NUM_STATS; s++) suffixUp[NUM_SLOTS][s] = 0;
    for (let i = NUM_SLOTS - 1; i >= 0; i--) {
      for (let s = 0; s < NUM_STATS; s++) {
        suffixUp[i][s] = suffixUp[i + 1][s] + chosen[i].tuneStatUpside[s];
      }
    }

    const box: { winner: Winner | null } = { winner: null };
    const rec = (i: number): void => {
      // Joint-feasibility prune (both modes — it's admissible for a pure existence
      // check too, since suffixUp upper-bounds the tuning upside of every branch):
      // even with the best remaining tuning upside, if the mod points needed to close
      // every stat's deficit (each rounded up to the 5-point mod grain) exceed the
      // SHARED budget, this branch is dead. The top-N bounds are per-stat, so this
      // joint check is what cuts the demanding-target cliff, and it's what keeps
      // UNsatisfiable ceiling probes from degenerating into exhaustive walks.
      let needed = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const d = minShortfall(mins[s], aug[s] + suffixUp[i][s]);
        if (d > 0) {
          needed += deficitPoints(d, artCount > 0);
          if (needed > maxLeafPoints) return;
        }
      }
      // Branch-and-bound on the best reachable total (maximize only — feasible mode
      // takes any feasible leaf): clamp(x+m) ≤ clamp(x)+m, so this over-estimates the
      // best total still reachable from here. The default option (Balanced when
      // allowed) is enumerated first, seeding a strong bound that prunes directionals.
      const w = box.winner;
      if (mode === "maximize" && w) {
        let ub = maxLeafPoints;
        for (let s = 0; s < NUM_STATS; s++) ub += clamp(aug[s] + suffixUp[i][s]);
        if (ub <= w.total) return;
      }
      if (i === NUM_SLOTS) {
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = minShortfall(mins[s], aug[s]);
        }
        const asg = assignMods(deficits, mods.major, mods.minor, artCount);
        if (!asg) return;
        const total = settleLeaf(asg, artCount, mode);
        if (!box.winner || total > box.winner.total) {
          const tuningBonus = new Array<number>(NUM_STATS);
          for (let s = 0; s < NUM_STATS; s++) {
            tuningBonus[s] = aug[s] - sum[s] - frag[s];
          }
          box.winner = {
            total,
            modBonus: asg.points.slice(),
            usedMajor: asg.usedMajor,
            usedMinor: asg.usedMinor,
            applied: curApplied.slice(),
            tuningBonus,
            // settleLeaf leaves the artifice scratch untouched on the zero path — share.
            artificeBonus:
              artCount === 0 ? ZERO_ARTIFICE_POINTS : artificePoints.slice(),
          };
        }
        return;
      }
      // Branch a piece's directionals only where they can feed a still-short stat
      // (directionalsBranchable — the same policy the pool-time upside bound uses);
      // otherwise the default option (opts[0]) dominates and only it is enumerated.
      const opts = chosen[i].tuneOpts;
      const limit = directionalsBranchable(chosen[i].exotic, chosen[i].tuned, isShort)
        ? opts.length
        : 1;
      for (let o = 0; o < limit; o++) {
        // Feasible mode early-exits at the first feasible leaf found.
        if (mode === "feasible" && box.winner) return;
        const opt = opts[o];
        curApplied[i] = opt.applied;
        for (let s = 0; s < NUM_STATS; s++) aug[s] += opt.vec[s];
        rec(i + 1);
        for (let s = 0; s < NUM_STATS; s++) aug[s] -= opt.vec[s];
      }
    };
    rec(0);

    return box.winner ? makeOutcome(chosen, sum, box.winner) : null;
  };
}
