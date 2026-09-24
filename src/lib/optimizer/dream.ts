/**
 * Dream build: which Tier-5 drops to farm to reach stat targets the owned armor can't.
 *
 * A Tier-5 roll is fully described by its archetype (primary 30 / secondary 25), its
 * tertiary stat (20), and its tuned stat; masterwork lifts the other three stats to 5.
 * So every piece the player could farm is enumerable, and the ordinary solver can search
 * it: replace k slots' candidates with every possible roll, keep the rest owned, and
 * raise k from 0 until something reaches the targets. The first k that works is the
 * fewest drops any build needs. The set a dream piece comes from is the player's call —
 * it only matters for required set bonuses, where each roll is offered once per
 * required set (a set piece is never worse than an unset one).
 *
 * Pure — no DOM/React deps, so it runs in a Web Worker and in Node tests.
 */
import { solve } from "./solve";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerPiece,
} from "./types";

const NUM_SLOTS = 5;
const NUM_STATS = 6;
const CLASS_ITEM_SLOT = 4;

/** Tier-5 archetype stat values: primary, secondary, tertiary. */
const T5_PRIMARY = 30;
const T5_SECONDARY = 25;
const T5_TERTIARY = 20;
/** MW5 lifts each of the three off-archetype stats to 5. */
const T5_MASTERWORKED_OFF_STAT = 5;

/** Whole dream search wall clock; each solve gets what's left (capped per solve). */
const DREAM_BUDGET_MS = 15000;
const DREAM_SOLVE_BUDGET_MS = 3000;
/** Ceiling refinement for the owned-armor pass (the sliders' "max" in dream mode). */
const OWNED_CEILING_BUDGET_MS = 1500;
/** Distinct farm options to return. */
const MAX_OPTIONS = 6;
/** Builds kept per k ≥ 2 subset solve before collapsing them to distinct options. */
const MULTI_PIECE_RESULTS = 50;

/** An Armor 3.0 archetype: its fixed primary (30) and secondary (25) stat indices. */
export interface DreamArchetype {
  name: string;
  primary: number;
  secondary: number;
}

/** The exotic a dream build may re-roll: the selected one (in its slot), or any. */
export type DreamExotic =
  | { kind: "none" }
  /** Any exotic: a generic Tier-5 exotic roll may fill any non-class-item slot. */
  | { kind: "any" }
  /** The selected exotic, re-rolled in its own slot. `intrinsic` = its def stat bonus. */
  | {
      kind: "specific";
      slot: number;
      hash: number;
      name: string;
      intrinsic: number[];
    };

export interface DreamInput {
  /** The live query over owned pieces — every constraint carries over unchanged. */
  base: OptimizerInput;
  archetypes: DreamArchetype[];
  exotic: DreamExotic;
  /** Slots that never take a dream piece (e.g. a class item pinned to Dreamer's Bond). */
  lockedSlots?: number[];
}

/** One farmable roll, as the solver sees it. */
export interface DreamPiece {
  id: string;
  slot: number;
  archetype: string;
  primary: number;
  secondary: number;
  tertiary: number;
  /**
   * Rolled tuned stat; null = any: an exotic (its flexible tuning takes any stat), or a
   * legendary searched untuned — if a build works with it, it works whatever the roll.
   */
  tuned: number | null;
  exotic: boolean;
  /** Display name of the specific exotic; undefined for a legendary or "any exotic". */
  exoticName?: string;
  /** Required set this roll counts toward, if any. */
  setHash?: number;
  /** Masterworked stats (plus the exotic's intrinsic bonus). */
  stats: number[];
}

/** A tertiary stat that works, with the tuned stats that work alongside it. */
export interface FarmRoll {
  tertiary: number;
  /** null = any tuned stat does. */
  tuned: number[] | null;
}

/** What to farm for one slot of a dream option: an archetype and the rolls that work. */
export interface FarmPiece {
  slot: number;
  archetype: string;
  primary: number;
  secondary: number;
  exotic: boolean;
  exoticName?: string;
  /**
   * Every tertiary that completes this build (its other pieces held as they are), easiest
   * first: those that work with any tuned stat, then those needing particular ones.
   */
  rolls: FarmRoll[];
}

/** How many of the possible (tertiary, tuned) drops of this archetype would do. */
export function farmOdds(f: FarmPiece): number {
  let n = 0;
  for (const r of f.rolls) n += r.tuned?.length ?? NUM_STATS;
  return n;
}

/** One way to reach the targets: a build and the new pieces it needs. */
export interface DreamOption {
  /** Piece ids are owned instance ids, except at the `farm` slots (dream ids). */
  loadout: OptimizerLoadout;
  farm: FarmPiece[];
}

export interface DreamResult {
  /**
   * Fewest new pieces any build needs: 0 = owned armor already reaches the targets,
   * null = not even a full set of new rolls does (or the search ran out of time first).
   */
  newPieces: number | null;
  /** Distinct farm options at that count, best build total first. Empty at 0 and null. */
  options: DreamOption[];
  /** True if any solve hit its time budget — "fewest" and the options are best-effort. */
  capped: boolean;
  /**
   * What the owned armor alone reaches per stat, given the other five targets (the
   * regular search's ceilings, for these targets). Exact unless `ownedCeilingsExact` is
   * false, in which case they're achievable lower bounds.
   */
  ownedCeilings: number[];
  ownedCeilingsExact: boolean;
}

export interface DreamSolveOptions {
  budgetMs?: number;
  solveBudgetMs?: number;
  /** Called as the search starts checking builds with `newPieces` new pieces. */
  onPhase?: (newPieces: number) => void;
}

/** Every (archetype, tertiary) roll's masterworked stats. */
export function dreamRolls(
  archetypes: DreamArchetype[],
): { archetype: DreamArchetype; tertiary: number; stats: number[] }[] {
  const out = [];
  for (const archetype of archetypes) {
    for (let tertiary = 0; tertiary < NUM_STATS; tertiary++) {
      if (tertiary === archetype.primary || tertiary === archetype.secondary) continue;
      const stats = new Array(NUM_STATS).fill(T5_MASTERWORKED_OFF_STAT);
      stats[archetype.primary] = T5_PRIMARY;
      stats[archetype.secondary] = T5_SECONDARY;
      stats[tertiary] = T5_TERTIARY;
      out.push({ archetype, tertiary, stats });
    }
  }
  return out;
}

/** The three off-archetype stats of a roll (the Balanced Tuning targets). */
function offStatsOf(primary: number, secondary: number, tertiary: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < NUM_STATS; s++) {
    if (s !== primary && s !== secondary && s !== tertiary) out.push(s);
  }
  return out;
}

/** What to farm, ignoring tertiary, tuned stat, and set: what the options are distinct by. */
function rollGroup(d: DreamPiece): string {
  return `${d.slot}:${d.archetype}:${d.exotic ? "E" : "L"}`;
}

/** Every dream roll that may fill `slot`, as optimizer pieces plus their descriptions. */
export function dreamCandidates(slot: number, input: DreamInput): DreamPiece[] {
  const reqSets = (input.base.setRequirements ?? []).map((r) => r.setHash);
  // With set requirements, a roll in a required set dominates the same roll in none.
  const setOptions: (number | undefined)[] = reqSets.length ? reqSets : [undefined];
  const out: DreamPiece[] = [];

  for (const { archetype, tertiary, stats } of dreamRolls(input.archetypes)) {
    const roll = {
      slot,
      archetype: archetype.name,
      primary: archetype.primary,
      secondary: archetype.secondary,
      tertiary,
    };
    const key = `dream:${slot}:${archetype.name}:${tertiary}`;
    for (const setHash of setOptions) {
      out.push({ ...roll, id: `${key}:any:${setHash ?? 0}`, tuned: null, exotic: false, setHash, stats });
      for (let tuned = 0; tuned < NUM_STATS; tuned++) {
        out.push({
          ...roll,
          id: `${key}:${tuned}:${setHash ?? 0}`,
          tuned,
          exotic: false,
          setHash,
          stats,
        });
      }
    }

    const ex = input.exotic;
    const exoticHere =
      ex.kind === "specific" ? ex.slot === slot : ex.kind === "any" && slot !== CLASS_ITEM_SLOT;
    if (!exoticHere) continue;
    out.push({
      ...roll,
      id: `${key}:x:E${ex.kind === "specific" ? ex.hash : 0}`,
      tuned: null,
      exotic: true,
      exoticName: ex.kind === "specific" ? ex.name : undefined,
      stats: ex.kind === "specific" ? stats.map((v, s) => v + (ex.intrinsic[s] ?? 0)) : stats,
    });
  }
  return out;
}

/** Needs no particular tuned stat: an exotic, or a legendary searched untuned. */
function anyTuned(d: DreamPiece): boolean {
  return d.tuned === null;
}

function toOptimizerPiece(d: DreamPiece, input: DreamInput): OptimizerPiece {
  // An exotic's tuning socket is flexible (any +5 direction), so its `tuned` is moot;
  // an any-tuned legendary is searched without tuning at all.
  const tuning =
    d.exotic || d.tuned !== null
      ? { tuned: d.tuned ?? d.primary, offStats: offStatsOf(d.primary, d.secondary, d.tertiary) }
      : undefined;
  const hash = d.exotic && input.exotic.kind === "specific" ? input.exotic.hash : undefined;
  return { id: d.id, stats: d.stats, exotic: d.exotic, hash, setHash: d.setHash, tuning };
}

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}

/**
 * Find the fewest dream pieces any build needs, and distinct farm options at that
 * count. For each k, every k-subset of (unlocked) slots is searched with those slots
 * holding only dream rolls and the rest only owned pieces, so a build at k is found
 * before any at k+1 is considered.
 *
 * A plain top-N at k = 1 is one roll combined with many owned sets, so single-piece
 * options are found best-first instead: take the best build across slots, record its
 * roll, rule that roll out, and re-search only that slot.
 */
export function solveDream(input: DreamInput, opts: DreamSolveOptions = {}): DreamResult {
  const deadline = performance.now() + (opts.budgetMs ?? DREAM_BUDGET_MS);
  const solveBudget = opts.solveBudgetMs ?? DREAM_SOLVE_BUDGET_MS;
  const locked = new Set(input.lockedSlots ?? []);
  const dream = Array.from({ length: NUM_SLOTS }, (_, slot) =>
    locked.has(slot) ? [] : dreamCandidates(slot, input),
  );
  const byId = new Map(dream.flat().map((d) => [d.id, d]));
  let capped = false;
  let timedOut = false;

  /** Candidates per slot: `dreamSlots`' rolls where given, else `owned(slot)`. */
  const slotsWith = (
    dreamSlots: Map<number, DreamPiece[]>,
    owned: (slot: number) => OptimizerPiece[] = (slot) => input.base.slots[slot],
  ): OptimizerPiece[][] =>
    Array.from({ length: NUM_SLOTS }, (_, slot) => {
      const d = dreamSlots.get(slot);
      return d ? d.map((p) => toOptimizerPiece(p, input)) : owned(slot);
    });

  /** One solve over `slots`; null once out of time. */
  const solveOnce = (slots: OptimizerPiece[][], maxResults: number, ceilingBudgetMs = 0) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      timedOut = capped = true;
      return null;
    }
    const out = solve(
      { ...input.base, slots, maxResults },
      { topNBudgetMs: Math.min(solveBudget, remaining), ceilingBudgetMs },
    );
    if (out.capped) capped = true;
    return out;
  };
  const run = (slots: OptimizerPiece[][], maxResults: number): OptimizerLoadout[] | null =>
    solveOnce(slots, maxResults)?.loadouts ?? null;

  /**
   * Every roll of `lo`'s archetype at `slot` (same set) that keeps it valid with its
   * other pieces held fixed, grouped by tertiary. An any-tuned or exotic variant working
   * means the tertiary works whatever the tuned stat.
   */
  const rollsThatWork = (lo: OptimizerLoadout, slot: number): FarmRoll[] => {
    const d = byId.get(lo.pieceIds[slot])!;
    const variants = dream[slot].filter(
      (v) => rollGroup(v) === rollGroup(d) && v.setHash === d.setHash,
    );
    const fixed = new Map<number, DreamPiece[]>([[slot, variants]]);
    lo.pieceIds.forEach((id, s) => {
      const other = byId.get(id);
      if (s !== slot && other) fixed.set(s, [other]);
    });
    const slots = slotsWith(fixed, (s) =>
      input.base.slots[s].filter((p) => p.id === lo.pieceIds[s]),
    );
    const works = [d];
    for (const l of run(slots, variants.length) ?? []) works.push(byId.get(l.pieceIds[slot])!);
    const byTertiary = new Map<number, Set<number> | null>();
    for (const v of works) {
      const prev = byTertiary.get(v.tertiary);
      if (anyTuned(v) || prev === null) byTertiary.set(v.tertiary, null);
      else byTertiary.set(v.tertiary, (prev ?? new Set()).add(v.tuned!));
    }
    return [...byTertiary]
      .map(([tertiary, tuned]) => ({
        tertiary,
        tuned: tuned && tuned.size < NUM_STATS ? [...tuned].sort((a, b) => a - b) : null,
      }))
      .sort(
        (a, b) =>
          (b.tuned?.length ?? NUM_STATS) - (a.tuned?.length ?? NUM_STATS) ||
          a.tertiary - b.tertiary,
      );
  };

  const optionFor = (lo: OptimizerLoadout): DreamOption => ({
    loadout: lo,
    farm: lo.pieceIds.flatMap((id, slot) => {
      const d = byId.get(id);
      if (!d) return [];
      return [
        {
          slot,
          archetype: d.archetype,
          primary: d.primary,
          secondary: d.secondary,
          exotic: d.exotic,
          exoticName: d.exoticName,
          rolls: rollsThatWork(lo, slot),
        },
      ];
    }),
  });

  // k = 0: the owned armor alone — also what the sliders show as each stat's max.
  opts.onPhase?.(0);
  const owned = solveOnce(input.base.slots, 1, OWNED_CEILING_BUDGET_MS);
  const ownedCeilings = owned?.ceilings ?? new Array(NUM_STATS).fill(0);
  const ownedCeilingsExact = owned?.ceilingsExact ?? false;
  const done = (newPieces: number | null, options: DreamOption[]): DreamResult => ({
    newPieces,
    options,
    capped,
    ownedCeilings,
    ownedCeilingsExact,
  });
  if (owned?.loadouts.length) return done(0, []);
  opts.onPhase?.(1);

  // k = 1, best-first over distinct archetypes per slot: first those with a roll that
  // works with any tuned stat (the easiest drops to find), then the rest. Every T5 roll
  // totals the same, so ties are common; among equal totals, prefer an archetype not
  // listed yet (in any slot), then the one more drops would satisfy, then a slot with
  // fewer options.
  const excluded = Array.from({ length: NUM_SLOTS }, () => new Set<string>());
  const best: (DreamOption | null)[] = new Array(NUM_SLOTS).fill(null);
  let flexibleOnly = true;
  const searchSlot = (slot: number) => {
    const pool = dream[slot].filter(
      (d) => !excluded[slot].has(rollGroup(d)) && (!flexibleOnly || anyTuned(d)),
    );
    const lo = pool.length ? run(slotsWith(new Map([[slot, pool]])), 1)?.[0] : undefined;
    best[slot] = lo ? optionFor(lo) : null;
  };
  for (let slot = 0; slot < NUM_SLOTS; slot++) searchSlot(slot);
  const single: DreamOption[] = [];
  const listedRolls = new Set<string>();
  const perSlot = new Array(NUM_SLOTS).fill(0);
  const rollOf = (o: DreamOption) => `${o.farm[0].archetype}:${o.farm[0].exotic}`;
  const flexibility = (o: DreamOption) => farmOdds(o.farm[0]);
  const beats = (a: DreamOption, sa: number, b: DreamOption, sb: number): boolean => {
    if (a.loadout.total !== b.loadout.total) return a.loadout.total > b.loadout.total;
    const newA = !listedRolls.has(rollOf(a));
    const newB = !listedRolls.has(rollOf(b));
    if (newA !== newB) return newA;
    if (flexibility(a) !== flexibility(b)) return flexibility(a) > flexibility(b);
    return perSlot[sa] < perSlot[sb];
  };
  while (single.length < MAX_OPTIONS && !timedOut) {
    let slot = -1;
    for (let s = 0; s < NUM_SLOTS; s++) {
      if (best[s] && (slot < 0 || beats(best[s]!, s, best[slot]!, slot))) slot = s;
    }
    if (slot < 0 && flexibleOnly) {
      flexibleOnly = false;
      for (let s = 0; s < NUM_SLOTS; s++) searchSlot(s);
      continue;
    }
    if (slot < 0) break;
    const option = best[slot]!;
    single.push(option);
    listedRolls.add(rollOf(option));
    perSlot[slot]++;
    excluded[slot].add(rollGroup(byId.get(option.loadout.pieceIds[slot])!));
    searchSlot(slot);
  }
  if (single.length) return done(1, single);

  // k ≥ 2: top builds per subset, collapsed to one per combination of rolls.
  for (let k = 2; k <= NUM_SLOTS && !timedOut; k++) {
    opts.onPhase?.(k);
    const bySignature = new Map<string, OptimizerLoadout>();
    for (let mask = 0; mask < 1 << NUM_SLOTS; mask++) {
      if (popcount(mask) !== k) continue;
      const dreamSlots = new Map<number, DreamPiece[]>();
      for (let s = 0; s < NUM_SLOTS; s++) if (mask & (1 << s)) dreamSlots.set(s, dream[s]);
      if ([...dreamSlots.values()].some((d) => d.length === 0)) continue;
      const found = run(slotsWith(dreamSlots), MULTI_PIECE_RESULTS);
      if (!found) break;
      for (const lo of found) {
        const sig = lo.pieceIds
          .map((id) => byId.get(id))
          .filter((d): d is DreamPiece => !!d)
          .map(rollGroup)
          .join("|");
        const prev = bySignature.get(sig);
        if (!prev || lo.total > prev.total) bySignature.set(sig, lo);
      }
    }
    if (bySignature.size) {
      const options = [...bySignature.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, MAX_OPTIONS)
        .map(optionFor);
      return done(k, options);
    }
  }
  return done(null, []);
}
