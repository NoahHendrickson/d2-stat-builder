/** Pure optimizer types — no DOM/React deps so this runs in a Web Worker and in Node tests. */

/** Six stat values in canonical order: [weapons, health, class, grenade, super, melee]. */
export type StatArray = number[];

/** Tier-5 tuning options for a single piece (present iff the piece can be tuned). */
export interface PieceTuning {
  /** Index (0–5) of the rolled tuned stat — the stat directional tuning adds +5 to. */
  tuned: number;
  /** The 3 off-archetype stat indices that Balanced Tuning adds +1 to each. */
  offStats: number[];
}

export interface OptimizerPiece {
  id: string;
  stats: StatArray;
  exotic: boolean;
  /** Item hash (used to force a specific exotic). */
  hash?: number;
  /** Armor set this piece belongs to (for set-bonus requirements), if any. */
  setHash?: number;
  /** Tier-5 tuning, if this piece can be tuned. The optimizer auto-picks the tune. */
  tuning?: PieceTuning;
  /**
   * Artifice piece (legacy exotic) — has a free +3 any-stat mod slot, outside the
   * normal mod budget. The optimizer auto-picks the stat. Mutually exclusive with
   * `tuning` in practice (artifice is legacy-only, tuning is Tier-5-only).
   */
  artifice?: boolean;
}

/** Require at least `count` equipped pieces from a given armor set (2 = 2pc bonus, 4 = 4pc). */
export interface SetRequirement {
  setHash: number;
  count: number;
}

export type ExoticMode = "any" | "none" | "require" | "specific";

export interface ExoticConstraint {
  /** any = ≤1 exotic (optimizer's choice) · none = no exotic · require = exactly 1 · specific = one of `hashes`. */
  mode: ExoticMode;
  /** Item hashes of the forced exotic when mode = "specific" (all versions of that exotic). */
  hashes?: number[];
}

export interface ModBudget {
  /** Number of major (+10) stat mods available. */
  major: number;
  /** Number of minor (+5) stat mods available. major + minor must be <= 5. */
  minor: number;
}

export interface OptimizerInput {
  /** Candidate pieces per slot, exactly 5 slots: helmet, arms, chest, legs, classItem. */
  slots: OptimizerPiece[][];
  /** Per-stat minimum targets (length 6). */
  minimums: StatArray;
  /** Budget of stat mods the optimizer may auto-assign to reach the targets. */
  mods?: ModBudget;
  /** Required armor set bonuses — every returned loadout satisfies all of these. */
  setRequirements?: SetRequirement[];
  /** Exotic constraint (defaults to "any"). */
  exotic?: ExoticConstraint;
  /** Allow the optimizer to apply Tier-5 tuning on tunable pieces (defaults to true). */
  allowTuning?: boolean;
  /** Build-wide stat constant from selected subclass fragments (may be negative). */
  fragmentBonus?: StatArray;
  /** Max loadouts to return (default 200). */
  maxResults?: number;
}

/** The tuning the optimizer applied to one piece. */
export type AppliedTuning =
  | { kind: "balanced" }
  | { kind: "directional"; plus: number; minus: number };

export interface OptimizerLoadout {
  /** One piece id per slot. */
  pieceIds: string[];
  /** Summed masterworked base stats of the 5 pieces (before tuning/mods), capped at 200. */
  baseStats: StatArray;
  /** Final six-stat totals after applied tuning + mods, clamped to 0–200. */
  stats: StatArray;
  /** Net points each stat gained (or lost) from applied tuning. */
  tuningBonus: StatArray;
  /** The tuning applied per slot (aligned to pieceIds); null where the piece was left untuned. */
  tuning: (AppliedTuning | null)[];
  /** Points each stat gained from assigned mods. */
  modBonus: StatArray;
  /** How many major / minor mods were used. */
  modsUsed: { major: number; minor: number };
  /** Points each stat gained from artifice (+3) mods. */
  artificeBonus: StatArray;
  /** Per slot: the stat index the piece's artifice +3 went to (null = no artifice / unspent). */
  artifice: (number | null)[];
  total: number;
  exotic: boolean;
}

export interface OptimizerOutput {
  loadouts: OptimizerLoadout[];
  combosTried: number;
  combosValid: number;
  /**
   * Max reachable value for each stat, subject to the current minimums on the OTHER
   * five stats only (each stat's own minimum is ignored when maximizing it). Drives the
   * per-slider "headroom" cap. Exact when the search fits its budget, otherwise a
   * guaranteed-achievable lower bound. All zero when there are no pieces.
   */
  ceilings: StatArray;
  /** True if the top-N search hit its time budget and returned best-effort results. */
  capped: boolean;
}

/** Main thread → worker: a search request tagged with a monotonically increasing seq. */
export interface OptimizerRequest {
  seq: number;
  input: OptimizerInput;
}

/**
 * Worker → main thread, echoing the request's seq so stale runs can be dropped. Progress
 * (a 0–1 fraction) and ceilings (seed, then each refined stat) stream ahead of "result".
 *
 * A time-capped search posts its result with `refining: true` — its build list is frozen
 * for this query (a list never changes under the reader) — then the background session
 * refines the ceilings AND re-runs the build search exhaustively. If that beats the
 * frozen list, a "better" message offers the replacement (the UI swaps it in only on an
 * explicit user action). A final `refining: false` result always follows, carrying the
 * SAME frozen loadouts with the refined ceilings; `verified` is true when the background
 * build search ran to exhaustion (so "nothing better exists" is a proven claim).
 */
export type OptimizerResponse =
  | { seq: number; kind: "progress"; progress: number }
  | { seq: number; kind: "ceilings"; ceilings: StatArray }
  | { seq: number; kind: "better"; output: OptimizerOutput }
  | {
      seq: number;
      kind: "result";
      output: OptimizerOutput;
      refining: boolean;
      verified: boolean;
    };
