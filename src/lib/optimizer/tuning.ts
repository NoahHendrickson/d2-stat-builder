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

export const NUM_STATS = 6;
export const NUM_SLOTS = 5;
export const STAT_CAP = 200;

export const clamp = (v: number): number =>
  v < 0 ? 0 : v > STAT_CAP ? STAT_CAP : v;

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
  total: number;
  /** Index of the rolled tuned stat (the +5 target), or -1 if the piece can't be tuned. */
  tuned: number;
  /** Tuning choices the optimizer may pick from (always ≥1 — the no-tune option). */
  tuneOpts: TuneOption[];
  /** Best positive tuning contribution reachable per stat (for admissible pruning). */
  tuneStatUpside: number[];
  /** Best total tuning contribution reachable (Balanced = +3; else 0). */
  tuneTotalUpside: number;
}

function statTotal(stats: number[]): number {
  let t = 0;
  for (let i = 0; i < NUM_STATS; i++) t += stats[i];
  return t;
}

/**
 * Every tuning option for a piece: no-tune only when it can't be tuned (or tuning is
 * off), else Balanced (+1 to each off-archetype stat) plus directionals (+5 to a tuned
 * stat, −5 to another). "No tune" is omitted for tunable pieces because Balanced weakly
 * dominates it (pure upside, no downside).
 *
 * Legendaries can only put the +5 on their one rolled tuned stat. Tier-5 EXOTICS have a
 * flexible tuning slot — their +5 can go to ANY stat — so we generate a directional for
 * every (+stat, −stat) pair.
 */
export function buildTuneOpts(
  tuning: PieceTuning | undefined,
  allow: boolean,
  isExotic: boolean,
): TuneOption[] {
  if (!allow || !tuning) return [{ vec: [0, 0, 0, 0, 0, 0], applied: null }];
  const opts: TuneOption[] = [];
  const balanced = [0, 0, 0, 0, 0, 0];
  for (const s of tuning.offStats) balanced[s] += 1;
  opts.push({ vec: balanced, applied: { kind: "balanced" } });
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

/** Build the optimizer's internal piece representation (tune options + upside bounds). */
export function makeInternalPiece(
  p: OptimizerPiece,
  allowTuning: boolean,
): InternalPiece {
  const tuneOpts = buildTuneOpts(p.tuning, allowTuning, p.exotic);
  const tuneStatUpside = new Array(NUM_STATS).fill(0);
  let tuneTotalUpside = 0;
  for (const opt of tuneOpts) {
    let optTotal = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      if (opt.vec[s] > tuneStatUpside[s]) tuneStatUpside[s] = opt.vec[s];
      optTotal += opt.vec[s];
    }
    if (optTotal > tuneTotalUpside) tuneTotalUpside = optTotal;
  }
  return {
    id: p.id,
    stats: p.stats,
    exotic: p.exotic,
    hash: p.hash,
    setHash: p.setHash,
    total: statTotal(p.stats),
    tuned: allowTuning && p.tuning ? p.tuning.tuned : -1,
    tuneOpts,
    tuneStatUpside,
    tuneTotalUpside,
  };
}

/**
 * Cheapest assignment of major (+10) / minor (+5) stat mods covering every stat's
 * deficit within the budget. Returns per-stat points + counts, or null if infeasible.
 */
export function assignMods(
  deficits: number[],
  maxMajor: number,
  maxMinor: number,
): { points: number[]; usedMajor: number; usedMinor: number } | null {
  const major = new Array(NUM_STATS).fill(0);
  const minor = new Array(NUM_STATS).fill(0);

  const rec = (s: number, majorsLeft: number, minorsLeft: number): boolean => {
    if (s === NUM_STATS) return true;
    const need = deficits[s];
    if (need <= 0) return rec(s + 1, majorsLeft, minorsLeft);
    const maxA = Math.min(majorsLeft, Math.ceil(need / 10));
    for (let a = maxA; a >= 0; a--) {
      const remainder = need - a * 10;
      const b = remainder > 0 ? Math.ceil(remainder / 5) : 0;
      if (b > minorsLeft) continue;
      major[s] = a;
      minor[s] = b;
      if (rec(s + 1, majorsLeft - a, minorsLeft - b)) return true;
    }
    major[s] = 0;
    minor[s] = 0;
    return false;
  };

  if (!rec(0, maxMajor, maxMinor)) return null;
  const points = major.map((a, i) => a * 10 + minor[i] * 5);
  return {
    points,
    usedMajor: major.reduce((x, y) => x + y, 0),
    usedMinor: minor.reduce((x, y) => x + y, 0),
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
}

/**
 * Pick the tuning (+ mods) for a full loadout. Model (confirmed with Noah): every
 * tunable piece takes Balanced (+1 to each off-archetype stat) as free upside, and a
 * directional tune (+5 tuned / −5 chosen) is spent only to bridge a minimum that
 * Balanced can't reach. So Balanced-everywhere is the answer whenever it already meets
 * the minimums (the common, O(pieces) case); only when it falls short is the directional
 * search run (branch-and-bound, Balanced enumerated first per piece).
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
  // Which stats Balanced left short (so a directional on a piece tuned to that stat can help).
  const shortStat: boolean[] = new Array(NUM_STATS).fill(false);
  const curApplied: (AppliedTuning | null)[] = new Array(NUM_SLOTS).fill(null);
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
  }

  const makeOutcome = (sum: number[], w: Winner): TuningOutcome => {
    const stats = new Array<number>(NUM_STATS);
    for (let s = 0; s < NUM_STATS; s++) {
      stats[s] = clamp(sum[s] + frag[s] + w.tuningBonus[s] + w.modBonus[s]);
    }
    return {
      total: w.total,
      stats,
      tuningBonus: w.tuningBonus,
      applied: w.applied,
      modBonus: w.modBonus,
      modsUsed: { major: w.usedMajor, minor: w.usedMinor },
    };
  };

  return (chosen, sum, mins, mode) => {
    // Fast path: Balanced on every tunable piece (tuneOpts[0] is Balanced, or the
    // no-tune option for a piece that can't be tuned). If that already clears the
    // minimums, it's this loadout's best tuning — return without touching directionals.
    for (let s = 0; s < NUM_STATS; s++) aug[s] = sum[s] + frag[s];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const bal = chosen[i].tuneOpts[0];
      curApplied[i] = bal.applied;
      for (let s = 0; s < NUM_STATS; s++) aug[s] += bal.vec[s];
    }
    for (let s = 0; s < NUM_STATS; s++) {
      deficits[s] = Math.max(0, mins[s] - aug[s]);
    }
    const balAsg = assignMods(deficits, mods.major, mods.minor);
    if (balAsg) {
      const tuningBonus = new Array<number>(NUM_STATS);
      let total = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        tuningBonus[s] = aug[s] - sum[s] - frag[s];
        total += clamp(aug[s] + balAsg.points[s]);
      }
      return makeOutcome(sum, {
        total,
        modBonus: balAsg.points.slice(),
        usedMajor: balAsg.usedMajor,
        usedMinor: balAsg.usedMinor,
        applied: curApplied.slice(),
        tuningBonus,
      });
    }

    // Slow path: Balanced falls short of a minimum — branch the directional tunes.
    // `deficits` still holds Balanced's shortfall: a directional only helps a short stat.
    for (let s = 0; s < NUM_STATS; s++) shortStat[s] = deficits[s] > 0;
    // Reset the fast path's Balanced accumulation: rec() re-adds every piece's tuning
    // (Balanced is tuneOpts[0]), so aug must restart at sum+frag or Balanced would be
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
        const d = mins[s] - (aug[s] + suffixUp[i][s]);
        if (d > 0) {
          needed += Math.ceil(d / 5) * 5;
          if (needed > maxModPoints) return;
        }
      }
      // Branch-and-bound on the best reachable total (maximize only — feasible mode
      // takes any feasible leaf): clamp(x+m) ≤ clamp(x)+m, so this over-estimates the
      // best total still reachable from here. Balanced is enumerated first (highest
      // total), seeding a strong bound that prunes directional branches.
      const w = box.winner;
      if (mode === "maximize" && w) {
        let ub = maxModPoints;
        for (let s = 0; s < NUM_STATS; s++) ub += clamp(aug[s] + suffixUp[i][s]);
        if (ub <= w.total) return;
      }
      if (i === NUM_SLOTS) {
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = Math.max(0, mins[s] - aug[s]);
        }
        const asg = assignMods(deficits, mods.major, mods.minor);
        if (!asg) return;
        let total = 0;
        for (let s = 0; s < NUM_STATS; s++) total += clamp(aug[s] + asg.points[s]);
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
          };
        }
        return;
      }
      // A directional only helps if this piece is tuned to a still-short stat; otherwise
      // Balanced (opts[0]) dominates it, so don't branch the directionals. Exotics are
      // flexible — they can put +5 into any short stat — so always branch their options.
      const opts = chosen[i].tuneOpts;
      const t = chosen[i].tuned;
      const limit = chosen[i].exotic || (t >= 0 && shortStat[t]) ? opts.length : 1;
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

    return box.winner ? makeOutcome(sum, box.winner) : null;
  };
}
