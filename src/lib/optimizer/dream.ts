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
// Type-only (erased): keeps the worker bundle free of the armory/manifest modules.
import type { ArmorArchetype } from "../armory/archetypes";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerPiece,
} from "./types";

const NUM_SLOTS = 5;
const NUM_STATS = 6;

/** Tier-5 archetype stat values: primary, secondary, tertiary. */
const T5_PRIMARY = 30;
const T5_SECONDARY = 25;
const T5_TERTIARY = 20;
/** MW5 lifts each of the three off-archetype stats to 5. */
const T5_MASTERWORKED_OFF_STAT = 5;

/** Whole dream search wall clock; each solve gets what's left (capped per solve). */
const DREAM_BUDGET_MS = 15000;
const DREAM_SOLVE_BUDGET_MS = 3000;
/** Ceiling refinement for the owned and possible passes (the sliders' max / reach). */
const OWNED_CEILING_BUDGET_MS = 1500;
/** Build-walk budget for the ceilings-only pass (it only seeds the ceiling search). */
const CEILINGS_ONLY_TOPN_BUDGET_MS = 300;
/** Distinct farm options to return. */
const MAX_OPTIONS = 6;
/**
 * Builds kept per k ≥ 2 subset solve before collapsing them to distinct options. Unlike
 * k = 1 (a best-first walk over distinct archetypes), k ≥ 2 has no diversity guarantee:
 * every T5 roll totals the same, so these are often permutations of one or two archetype
 * pairs and fewer than MAX_OPTIONS distinct options survive. Acceptable while k ≥ 2 is
 * the rare "far out of reach" case; a per-subset exclusion walk would fix it if not.
 */
const MULTI_PIECE_RESULTS = 50;
/**
 * Budget for enumerating one option's working rolls (four pieces fixed, one slot of at
 * most ~28 variants — near-instant). Kept apart from the search deadline so a search
 * that ran long can't starve it and understate a drop's odds.
 */
const ROLLS_SOLVE_BUDGET_MS = 500;
/** An exotic's possible drops: its four tertiaries (its tuning is flexible). */
const EXOTIC_ROLLS = 4;
/** A legendary archetype's possible drops: 4 tertiaries × 6 tuned stats. */
const LEGENDARY_ROLLS = 4 * NUM_STATS;

/** The exotic a dream build may re-roll in its own slot, if any. */
export type DreamExotic =
  | { kind: "none" }
  /** The build's exotic, re-rolled in its own slot. `intrinsic` = its def stat bonus. */
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
  archetypes: ArmorArchetype[];
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
  /** The required set this piece must come from (only when the query requires sets). */
  setHash?: number;
  /**
   * The tertiaries that complete this build, easiest first: those that work with any
   * tuned stat, then those needing particular ones. Only an option's FIRST farm piece
   * lists alternatives, checked with every other replacement held at exactly its listed
   * roll; later pieces list just that roll (`fixed`). Listing alternatives for two
   * pieces would imply any pairing works, and two individually-valid alternatives can
   * fail together.
   */
  rolls: FarmRoll[];
  /** This piece's roll is pinned as listed — the first piece's alternatives assume it. */
  fixed: boolean;
  /** False if enumerating `rolls` ran out of time: more may work than are listed. */
  complete: boolean;
}

/**
 * How many of this archetype's possible drops would do, out of how many: a legendary's
 * 4 tertiaries × 6 tuned stats, an exotic's 4 tertiaries (its tuning is flexible).
 */
export function farmOdds(f: FarmPiece): { n: number; of: number } {
  if (f.exotic) return { n: f.rolls.length, of: EXOTIC_ROLLS };
  let n = 0;
  for (const r of f.rolls) n += r.tuned?.length ?? NUM_STATS;
  return { n, of: LEGENDARY_ROLLS };
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
  /**
   * Distinct farm options at that count. At k = 1, easiest drops first — options that work
   * with any tuned stat, then the rest — each group best build total first; at k ≥ 2,
   * best total first. At 0, one option with no farm pieces: the owned build's plan for
   * these targets. Empty at null.
   */
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
  /**
   * What each stat could reach if any unlocked piece may be replaced by a farmed roll,
   * given the other five targets — the "possible" reach shown past the owned max. Same
   * exactness contract as `ownedCeilings`. Never below it (the owned pieces stay in).
   */
  possibleCeilings: number[];
  possibleCeilingsExact: boolean;
}

export interface DreamSolveOptions {
  budgetMs?: number;
  solveBudgetMs?: number;
  /** Called as the search starts checking builds with `newPieces` new pieces. */
  onPhase?: (newPieces: number) => void;
}

/** Every (archetype, tertiary) roll's masterworked stats. */
export function dreamRolls(
  archetypes: ArmorArchetype[],
): { archetype: ArmorArchetype; tertiary: number; stats: number[] }[] {
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

/**
 * What to farm, ignoring tertiary and tuned stat: what the options are distinct by. The
 * set is part of it — with set requirements, the same archetype from two required sets
 * is two different farm targets (only one of them may satisfy the build).
 */
function rollGroup(d: DreamPiece): string {
  return `${d.slot}:${d.archetype}:${d.exotic ? "E" : "L"}:${d.setHash ?? 0}`;
}

/**
 * A slot's rolls minus the Balanced-only (any-tuned) variants: each is dominated by the
 * same roll's tuned variants (same stats, a superset of tuning options), so it can't
 * raise a ceiling or win a subset solve. It matters only where "works whatever it
 * rolled" is the question: the k = 1 flexible pass and each option's roll enumeration.
 */
function withoutAnyTuned(pool: DreamPiece[]): DreamPiece[] {
  return pool.filter((d) => d.exotic || d.tuned !== null);
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
    const ex = input.exotic;
    // The exotic's own slot must hold the exotic (the query requires it), so legendary
    // rolls there are infeasible by construction.
    const exoticSlot = ex.kind === "specific" && ex.slot === slot;
    for (const setHash of exoticSlot ? [] : setOptions) {
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

    if (!exoticSlot) continue;
    out.push({
      ...roll,
      id: `${key}:x:E${ex.hash}`,
      tuned: null,
      exotic: true,
      exoticName: ex.name,
      stats: stats.map((v, s) => v + (ex.intrinsic[s] ?? 0)),
    });
  }
  return out;
}

/** Needs no particular tuned stat: an exotic, or a legendary searched untuned. */
function anyTuned(d: DreamPiece): boolean {
  return d.tuned === null;
}

function toOptimizerPiece(d: DreamPiece, input: DreamInput): OptimizerPiece {
  // An exotic's tuning socket is flexible (any +5 direction), so its `tuned` is moot.
  // An any-tuned legendary may take Balanced (every T5 can, whatever it rolled) but no
  // directional: if a build works with that, it works whatever the tuned stat.
  const offStats = offStatsOf(d.primary, d.secondary, d.tertiary);
  const tuning =
    d.exotic || d.tuned !== null
      ? { tuned: d.tuned ?? d.primary, offStats }
      : { tuned: d.primary, offStats, directional: false as const };
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
  // (build, slot) pairs whose roll enumeration ran out of time.
  const incomplete = new Set<string>();
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

  /**
   * One solve over `slots`; null once out of time. `ceilingsOnly`: a pass run just for
   * its ceilings, whose build list is discarded — a capped build walk there says
   * nothing about the options, so it doesn't mark the result capped.
   */
  const solveOnce = (
    slots: OptimizerPiece[][],
    maxResults: number,
    { ceilingBudgetMs = 0, ceilingsOnly = false } = {},
  ) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      timedOut = capped = true;
      return null;
    }
    const out = solve(
      { ...input.base, slots, maxResults },
      {
        topNBudgetMs: Math.min(ceilingsOnly ? CEILINGS_ONLY_TOPN_BUDGET_MS : solveBudget, remaining),
        ceilingBudgetMs,
      },
    );
    if (out.capped && !ceilingsOnly) capped = true;
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
      (v) => rollGroup(v) === rollGroup(d),
    );
    const fixed = new Map<number, DreamPiece[]>([[slot, variants]]);
    lo.pieceIds.forEach((id, s) => {
      const other = byId.get(id);
      if (s !== slot && other) fixed.set(s, [other]);
    });
    const slots = slotsWith(fixed, (s) =>
      input.base.slots[s].filter((p) => p.id === lo.pieceIds[s]),
    );
    const out = solve(
      { ...input.base, slots, maxResults: variants.length },
      { topNBudgetMs: ROLLS_SOLVE_BUDGET_MS, ceilingBudgetMs: 0 },
    );
    if (out.capped) incomplete.add(`${lo.pieceIds.join("|")}#${slot}`);
    const works = [d];
    for (const l of out.loadouts) works.push(byId.get(l.pieceIds[slot])!);
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

  const optionFor = (lo: OptimizerLoadout): DreamOption => {
    let first = true;
    return {
      loadout: lo,
      farm: lo.pieceIds.flatMap((id, slot) => {
        const d = byId.get(id);
        if (!d) return [];
        const fixed = !first;
        first = false;
        return [
          {
            slot,
            archetype: d.archetype,
            primary: d.primary,
            secondary: d.secondary,
            exotic: d.exotic,
            exoticName: d.exoticName,
            setHash: d.setHash,
            rolls: fixed
              ? [{ tertiary: d.tertiary, tuned: d.tuned === null ? null : [d.tuned] }]
              : rollsThatWork(lo, slot),
            fixed,
            complete: fixed || !incomplete.has(`${lo.pieceIds.join("|")}#${slot}`),
          },
        ];
      }),
    };
  };

  // k = 0: the owned armor alone — also what the sliders show as each stat's max.
  opts.onPhase?.(0);
  const owned = solveOnce(input.base.slots, 1, { ceilingBudgetMs: OWNED_CEILING_BUDGET_MS });
  const ownedCeilings = owned?.ceilings ?? new Array(NUM_STATS).fill(0);
  const ownedCeilingsExact = owned?.ceilingsExact ?? false;
  // The same ceilings with every unlocked slot also open to any farmable roll.
  const possible = solveOnce(
    slotsWith(new Map(), (slot) => [
      ...input.base.slots[slot],
      ...withoutAnyTuned(dream[slot]).map((p) => toOptimizerPiece(p, input)),
    ]),
    1,
    { ceilingBudgetMs: OWNED_CEILING_BUDGET_MS, ceilingsOnly: true },
  );
  const possibleCeilings = (possible?.ceilings ?? ownedCeilings).map((v, s) =>
    Math.max(v, ownedCeilings[s]),
  );
  const possibleCeilingsExact = possible?.ceilingsExact ?? false;
  const done = (newPieces: number | null, options: DreamOption[]): DreamResult => ({
    newPieces,
    options,
    capped,
    ownedCeilings,
    ownedCeilingsExact,
    possibleCeilings,
    possibleCeilingsExact,
  });
  // Reachable as is: return the build's own plan (the tuning and mods these targets
  // need can differ from the build as it was listed).
  if (owned?.loadouts.length) return done(0, [{ loadout: owned.loadouts[0], farm: [] }]);
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
  const flexibility = (o: DreamOption) => {
    const { n, of } = farmOdds(o.farm[0]);
    return n / of;
  };
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
      for (let s = 0; s < NUM_SLOTS; s++) {
        if (mask & (1 << s)) dreamSlots.set(s, withoutAnyTuned(dream[s]));
      }
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
