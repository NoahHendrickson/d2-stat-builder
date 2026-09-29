// The Compare view's perk finder (ported from the DIM branch new-compare-feature): pick
// the perks you want from every perk your copies of a weapon can roll, and it finds the
// fewest copies to keep. Left and right perks decide which copies are kept; masterwork,
// barrel, and magazine picks only order them, unless ranked above a left or right perk.
import type { PerkColumn, WeaponRoll } from "./weapon-details";

/**
 * The perk columns the finder lets you pick from, by index: barrel, magazine, left
 * trait, right trait, masterwork. Weapon types name their components differently
 * (blades and guards on swords), so columns go by position, not plug category.
 */
export const perkFinderColumnCount = 5;

/**
 * The masterwork column. Every masterwork can go on every copy, so this matches each
 * copy's current masterwork, by its stat hash.
 */
export const masterworkColumn = 4;

/** The left and right perk columns. */
export const leftColumn = 2;
export const rightColumn = 3;

/**
 * For each column, the (unenhanced) perk hashes a copy can roll there, or its
 * masterwork stat hash in the masterwork column. Empty if it doesn't have that column.
 */
export type ItemPerkColumns = Set<number>[];

/** A perk that appears in a column on at least one copy. */
export interface PerkFinderOption {
  /** The unenhanced perk hash, or the stat hash for masterworks. */
  hash: number;
  /** "Outlaw", or "Range" for a masterwork. */
  name: string;
  icon?: string;
  /** How many copies can roll it in this column. */
  count: number;
}

export interface PerkFinderColumn {
  /** Position of this column (0–4). */
  index: number;
  /** The game's name for its perks ("Barrel", "Magazine", "Trait"). */
  typeName: string;
  options: PerkFinderOption[];
}

/** A copy's barrel, magazine, and two trait columns, in that order (origin traits aside). */
export function finderPerkColumns(roll: WeaponRoll): (PerkColumn | undefined)[] {
  const perks = roll.columns.filter((c) => !c.origin);
  const components = perks.filter((c) => c.category !== "frames");
  const traits = perks.filter((c) => c.category === "frames");
  return [components[0], components[1], traits[0], traits[1]];
}

function masterworkOf(roll: WeaponRoll) {
  const mod = roll.mods.find((m) => m.kind === "masterwork");
  return mod?.stat ? { hash: mod.stat.hash, name: mod.stat.name, icon: mod.icon } : undefined;
}

export interface PerkFinderCopy {
  id: string;
  roll: WeaponRoll;
}

/**
 * Every perk available in each column across the copies, and each copy's perk columns.
 * A perk and its enhanced version share a name, so they count as one perk: the
 * unenhanced hash (when any copy has it) stands for both.
 */
export function perkFinderInput(copies: readonly PerkFinderCopy[]): {
  columns: PerkFinderColumn[];
  items: { id: string; columns: ItemPerkColumns }[];
} {
  // Per column, perk name → the hash and icon that stand for it.
  const canonical = Array.from(
    { length: perkFinderColumnCount },
    () => new Map<string, { hash: number; icon?: string; enhanced: boolean }>(),
  );
  const typeNames = Array<string>(perkFinderColumnCount).fill("");
  for (const { roll } of copies) {
    finderPerkColumns(roll).forEach((column, i) => {
      if (!column) return;
      typeNames[i] ||= column.typeName;
      for (const plug of column.options) {
        const seen = canonical[i]!.get(plug.name);
        if (!seen || (seen.enhanced && !plug.enhanced)) {
          canonical[i]!.set(plug.name, { hash: plug.hash, icon: plug.icon, enhanced: Boolean(plug.enhanced) });
        }
      }
    });
  }

  const columns: PerkFinderColumn[] = typeNames.map((typeName, index) => ({ index, typeName, options: [] }));
  const optionsByHash = columns.map(() => new Map<number, PerkFinderOption>());
  const add = (column: number, option: Omit<PerkFinderOption, "count">) => {
    const existing = optionsByHash[column]!.get(option.hash);
    if (existing) {
      existing.count++;
      return;
    }
    const created = { ...option, count: 1 };
    optionsByHash[column]!.set(option.hash, created);
    columns[column]!.options.push(created);
  };

  const items = copies.map(({ id, roll }) => {
    const perkColumns = finderPerkColumns(roll).map((column, i) => {
      const hashes = new Set<number>();
      for (const plug of column?.options ?? []) {
        const { hash, icon } = canonical[i]!.get(plug.name)!;
        // A copy may offer both the base and enhanced perk; count it once.
        if (hashes.has(hash)) continue;
        hashes.add(hash);
        add(i, { hash, name: plug.name, ...(icon ? { icon } : {}) });
      }
      return hashes;
    });
    const masterwork = masterworkOf(roll);
    if (masterwork) {
      add(masterworkColumn, {
        hash: masterwork.hash,
        name: masterwork.name,
        ...(masterwork.icon ? { icon: masterwork.icon } : {}),
      });
    }
    return { id, columns: [...perkColumns, new Set(masterwork ? [masterwork.hash] : [])] };
  });

  return { columns: columns.filter((c) => c.options.length > 0), items };
}

/** A picked perk: a perk hash in a particular column. */
export interface PerkPick {
  column: number;
  hash: number;
}

/**
 * Every picked perk, most important first. The ranking decides which copy is closest
 * to a combo when no copy has all of it.
 */
export type PerkPriority = PerkPick[];

/**
 * Every combo ("strict"): every combination of picked perks across columns should be
 * buildable on one kept copy. Every perk ("loose"): every picked perk should be on at
 * least one kept copy. My combos: every left + right combo the user made should be
 * buildable on one kept copy.
 */
export type PerkMatchMode = "strict" | "loose" | "combos";

/**
 * Left and right perks define the pool of copies to keep. The other columns only order
 * that pool, favoring copies with more of those picks.
 */
export const poolColumns = [leftColumn, rightColumn];
/** The columns that order the pool, in display order. */
export const orderColumns = [masterworkColumn, 0, 1];

export const isPoolPick = (pick: PerkPick) => poolColumns.includes(pick.column);

export const samePick = (a: PerkPick, b: PerkPick) => a.column === b.column && a.hash === b.hash;

/** A left perk and a right perk the user wants together on one copy. */
export type PerkCombo = [left: PerkPick, right: PerkPick];

/** Add a combo, unless it's already there. */
export function addCombo(combos: PerkCombo[], combo: PerkCombo): PerkCombo[] {
  return combos.some((c) => samePick(c[0], combo[0]) && samePick(c[1], combo[1]))
    ? combos
    : [...combos, combo];
}

/**
 * The picks in play. In combo mode, that's every left and right perk in a combo, plus
 * the masterwork, barrel, and magazine picks. Otherwise it's just the picks.
 */
export function activePicks(priority: PerkPriority, mode: PerkMatchMode, combos: PerkCombo[]): PerkPriority {
  if (mode !== "combos") return priority;
  const comboPicks = combos.flat().filter((pick, i, all) => all.findIndex((p) => samePick(p, pick)) === i);
  return [...comboPicks, ...priority.filter((pick) => !isPoolPick(pick))];
}

/** Order new picks: left and right perks, then masterworks, barrels, and magazines. */
const pickGroup = (column: number) => (poolColumns.includes(column) ? 0 : 1 + orderColumns.indexOf(column));

/**
 * The default order for picks: left perks, right perks, then masterworks, barrels, and
 * magazines, each in the order they're listed in their column.
 */
export function defaultPriority(priority: PerkPriority, columns: PerkFinderColumn[]) {
  const optionIndex = (pick: PerkPick) =>
    columns.find((c) => c.index === pick.column)?.options.findIndex((o) => o.hash === pick.hash) ?? -1;
  return priority.toSorted(
    (a, b) => pickGroup(a.column) - pickGroup(b.column) || a.column - b.column || optionIndex(a) - optionIndex(b),
  );
}

/**
 * Add or remove a pick. New picks go after the last pick in the same or an earlier
 * group, so the list stays in section order without disturbing a manual ordering.
 */
export function togglePick(priority: PerkPriority, pick: PerkPick): PerkPriority {
  if (priority.some((p) => samePick(p, pick))) return priority.filter((p) => !samePick(p, pick));
  const group = pickGroup(pick.column);
  const insertAt = priority.findLastIndex((p) => pickGroup(p.column) <= group) + 1;
  return priority.toSpliced(insertAt, 0, pick);
}

/**
 * The rank of each pick, from 0. Until the user turns on their own ranking every pick
 * is tied; with it on, picks rank in list order.
 */
export function pickRanks(priority: PerkPriority, customOrder: boolean): number[] {
  return priority.map((_pick, i) => (customOrder ? i : 0));
}

/**
 * Split picks into the ones that define the pool of copies to keep and the ones that
 * only order it. Left and right perks always define the pool; with the user's own
 * ranking on, so does any other pick ranked above a left or right perk.
 */
export function splitPicks(priority: PerkPriority, customOrder: boolean) {
  const lastPoolIndex = customOrder ? priority.findLastIndex(isPoolPick) : -1;
  const definesPool = (pick: PerkPick, i: number) => isPoolPick(pick) || i < lastPoolIndex;
  return {
    poolPicks: priority.filter(definesPool),
    orderPicks: priority.filter((pick, i) => !definesPool(pick, i)),
  };
}

/** One thing the user wants to be able to build: one or more picks, all on one copy. */
type Requirement = PerkPick[];

function buildRequirements(picks: PerkPick[], mode: "strict" | "loose"): Requirement[] {
  if (mode === "loose") return picks.map((pick) => [pick]);
  // Every combo: the cartesian product of picks across every column with picks.
  const pickedColumns = Map.groupBy(picks, (pick) => pick.column);
  let combos: Requirement[] = [[]];
  for (const columnPicks of pickedColumns.values()) {
    combos = combos.flatMap((combo) => columnPicks.map((pick) => [...combo, pick]));
  }
  return pickedColumns.size ? combos : [];
}

function hasPick(columns: ItemPerkColumns, { column, hash }: PerkPick) {
  return columns[column]?.has(hash) ?? false;
}

/**
 * How well a copy matches some picks: how many it has at each rank, most important
 * first. Compare with compareScores, so each rank outweighs all the ranks below it put
 * together, and tied picks count equally.
 */
export type PerkScore = number[];

function scorePicks(columns: ItemPerkColumns, picks: PerkPick[], rankOf: (pick: PerkPick) => number): PerkScore {
  const rankCount = Math.max(-1, ...picks.map(rankOf)) + 1;
  const score = Array<number>(rankCount).fill(0);
  for (const pick of picks) if (hasPick(columns, pick)) score[rankOf(pick)]!++;
  return score;
}

/** Positive if a is better than b, negative if worse, and 0 if they're equal. */
export function compareScores(a: PerkScore, b: PerkScore) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function sumScores(scores: PerkScore[]): PerkScore {
  const sum: PerkScore = [];
  for (const score of scores) for (let i = 0; i < score.length; i++) sum[i] = (sum[i] ?? 0) + score[i]!;
  return sum;
}

export interface PerkFinderResult {
  /** Copies to keep: the smallest set that covers every pool pick (or combo). */
  keep: Set<string>;
  /** Too many combinations to check them all, so a smaller set might exist. */
  approximate: boolean;
  /** How many picked perks each copy has, by id. */
  matchedCount: Map<string, number>;
  /** How well each copy matches the pool picks, by id. See compareScores. */
  poolScore: Map<string, PerkScore>;
  /** How well each copy matches the picks that only order the pool, by id. */
  orderScore: Map<string, PerkScore>;
  /** Total number of picked perks. */
  pickedCount: number;
  /** How many picks define the pool. */
  poolPickCount: number;
  /** How many requirements (perks or combos) at least one keepable copy has part of. */
  coveredRequirements: number;
  /** How many requirements no single copy has all of, so the closest is kept instead. */
  partialRequirements: number;
  totalRequirements: number;
}

export interface PerkFinderItem {
  id: string;
  columns: ItemPerkColumns;
  /**
   * Whether this copy can be one of the kept ones. False for rolls you don't own: they
   * are still scored and sorted, but never stand in for a copy you own. Default true.
   */
  keepable?: boolean;
}

/** Everything findPerkFinderResult reads, as one value (for the worker and memoizing). */
export interface PerkFinderArgs {
  items: PerkFinderItem[];
  priority: PerkPriority;
  mode: PerkMatchMode;
  customOrder: boolean;
  combos: PerkCombo[];
}

/**
 * Find the smallest set of copies that together fulfill every pool pick (loose), every
 * combination of them (strict), or every combo the user made (combos). Pool picks are
 * the left and right perks, plus anything ranked above them (see splitPicks). The other
 * picks never change how many copies are kept; they only decide between equally good
 * sets, and order the results.
 *
 * When no copy has all of a combo, the closest copies fulfill it instead: one with more
 * of the highest-ranked picks wins. Until the user turns on their own ranking
 * (customOrder), picks count equally. In combo mode the combos' perks are used instead
 * of the left and right picks, and they always count equally.
 */
export function findPerkFinderResult(
  items: PerkFinderItem[],
  priority: PerkPriority,
  mode: PerkMatchMode,
  customOrder = false,
  combos: PerkCombo[] = [],
): PerkFinderResult {
  const picks = activePicks(priority, mode, combos);
  const ranked = customOrder && mode !== "combos";
  const ranks = pickRanks(picks, ranked);
  const rankOf = (pick: PerkPick) => ranks[picks.findIndex((p) => samePick(p, pick))]!;
  const { poolPicks, orderPicks } = splitPicks(picks, ranked);

  const matchedCount = new Map(
    items.map((item) => [item.id, picks.filter((pick) => hasPick(item.columns, pick)).length]),
  );
  const poolScore = new Map(items.map((item) => [item.id, scorePicks(item.columns, poolPicks, rankOf)]));
  const orderScore = new Map(items.map((item) => [item.id, scorePicks(item.columns, orderPicks, rankOf)]));

  // Only copies that can be kept take part in deciding what to keep.
  const keepableItems = items.filter((item) => item.keepable !== false);
  const requirements = mode === "combos" ? combos : buildRequirements(poolPicks, mode);
  const fulfillment = requirements.map((req) => whoFulfills(keepableItems, req, rankOf));
  // For each keepable copy, the indexes of the requirements it fulfills.
  const coverage = keepableItems.map(
    (_item, itemIndex) =>
      new Set(fulfillment.flatMap(({ fulfilledBy }, i) => (fulfilledBy.has(itemIndex) ? [i] : []))),
  );
  const coverable = new Set(coverage.flatMap((c) => [...c]));

  const result: PerkFinderResult = {
    keep: new Set(),
    approximate: false,
    matchedCount,
    poolScore,
    orderScore,
    pickedCount: picks.length,
    poolPickCount: poolPicks.length,
    coveredRequirements: coverable.size,
    partialRequirements: fulfillment.filter((f) => f.partial).length,
    totalRequirements: requirements.length,
  };
  if (coverable.size === 0) return result;

  // Only copies that cover something are worth keeping.
  const candidates = keepableItems
    .map((item, i) => ({
      id: item.id,
      covers: coverage[i]!,
      orderScore: orderScore.get(item.id)!,
      poolScore: poolScore.get(item.id)!,
    }))
    .filter((c) => c.covers.size > 0);

  const { keep, approximate } = findSmallestCover(candidates, coverable);
  result.keep = new Set(keep.map((c) => c.id));
  result.approximate = approximate;
  return result;
}

/**
 * Sort by the result: copies to keep first, best matches for the picks that only order
 * the pool first among them. The rest follow, closest to the pool picks first.
 */
export function comparePerkFinderItems(result: PerkFinderResult) {
  return (a: string, b: string) => {
    const keepA = result.keep.has(a);
    const keepB = result.keep.has(b);
    if (keepA !== keepB) return keepA ? -1 : 1;
    const [first, second] = keepA ? [result.orderScore, result.poolScore] : [result.poolScore, result.orderScore];
    // A result still showing while a newer one is worked out may not know every copy.
    const score = (scores: Map<string, PerkScore>, id: string) => scores.get(id) ?? [];
    return compareScores(score(first, b), score(first, a)) || compareScores(score(second, b), score(second, a));
  };
}

/**
 * Which copies come closest to a requirement: the ones whose score on it (how many of
 * its picks they have at each rank, most important first) is the best.
 */
function whoFulfills(
  items: { columns: ItemPerkColumns }[],
  requirement: Requirement,
  rankOf: (pick: PerkPick) => number,
) {
  const scores = items.map((item) => scorePicks(item.columns, requirement, rankOf));
  const best = scores.reduce((a, b) => (compareScores(b, a) > 0 ? b : a), []);
  const bestCount = best.reduce((sum, count) => sum + count, 0);
  if (bestCount === 0) return { fulfilledBy: new Set<number>(), partial: false };
  return {
    fulfilledBy: new Set(scores.flatMap((score, i) => (compareScores(score, best) === 0 ? [i] : []))),
    partial: bestCount < requirement.length,
  };
}

interface Candidate {
  id: string;
  covers: Set<number>;
  orderScore: PerkScore;
  poolScore: PerkScore;
}

/** Between equally small sets, prefer more of the picks that order the pool, then pool picks. */
function isBetterSet(a: Candidate[], b: Candidate[]) {
  const sum = (set: Candidate[], key: "orderScore" | "poolScore") => sumScores(set.map((c) => c[key]));
  return (
    (compareScores(sum(a, "orderScore"), sum(b, "orderScore")) ||
      compareScores(sum(a, "poolScore"), sum(b, "poolScore"))) > 0
  );
}

/** Stop looking for a smaller set after this many search steps. */
const maxSearchSteps = 200_000;

/**
 * The smallest set of candidates that together cover every requirement, and the
 * best-scoring one of those (see isBetterSet).
 *
 * Starts from a greedy cover, then searches for smaller or better ones: at each step,
 * take the uncovered requirement with the fewest options and try each candidate that
 * covers it, ruling each out for the options after it so no set is visited twice.
 * Branches that can't beat the best set so far are skipped. If the search runs out of
 * steps the result is approximate: the best set found, but a smaller one might exist.
 */
function findSmallestCover(candidates: Candidate[], requirements: Set<number>) {
  let best = greedyCover(candidates, requirements);
  let steps = 0;
  const chosen: Candidate[] = [];
  const excluded = new Set<Candidate>();
  // How many of the chosen candidates cover each requirement.
  const coverCount = new Map([...requirements].map((r) => [r, 0]));
  const options = (requirement: number) => candidates.filter((c) => !excluded.has(c) && c.covers.has(requirement));

  const search = () => {
    if (steps >= maxSearchSteps) return;
    steps++;
    // Branch on the uncovered requirement with the fewest options.
    let fewest: Candidate[] | undefined;
    for (const [requirement, count] of coverCount) {
      if (count !== 0) continue;
      const opts = options(requirement);
      if (!fewest || opts.length < fewest.length) fewest = opts;
    }
    if (!fewest) {
      // Everything is covered.
      if (chosen.length < best.length || (chosen.length === best.length && isBetterSet(chosen, best))) {
        best = [...chosen];
      }
      return;
    }
    // Adding another candidate would make this set bigger than the best.
    if (chosen.length >= best.length) return;
    for (const candidate of fewest) {
      chosen.push(candidate);
      for (const r of candidate.covers) coverCount.set(r, coverCount.get(r)! + 1);
      search();
      chosen.pop();
      for (const r of candidate.covers) coverCount.set(r, coverCount.get(r)! - 1);
      excluded.add(candidate);
    }
    for (const candidate of fewest) excluded.delete(candidate);
  };
  search();
  return { keep: best, approximate: steps >= maxSearchSteps };
}

/**
 * Repeatedly keep whichever candidate covers the most remaining requirements, breaking
 * ties with isBetterSet, then drop any that turned out redundant.
 */
function greedyCover(candidates: Candidate[], requirements: Set<number>): Candidate[] {
  const chosen: Candidate[] = [];
  const covered = new Set<number>();
  while (covered.size < requirements.size) {
    let best: Candidate | undefined;
    let bestGain = 0;
    for (const c of candidates) {
      let gain = 0;
      for (const r of c.covers) if (!covered.has(r)) gain++;
      if (gain > bestGain || (gain > 0 && gain === bestGain && isBetterSet([c], [best!]))) {
        best = c;
        bestGain = gain;
      }
    }
    if (!best) break;
    chosen.push(best);
    for (const r of best.covers) covered.add(r);
  }
  // Later picks can make earlier ones redundant: drop any whose requirements the others cover.
  for (let i = chosen.length - 1; i >= 0; i--) {
    const others = chosen.filter((_c, j) => j !== i);
    if ([...chosen[i]!.covers].every((r) => others.some((o) => o.covers.has(r)))) chosen.splice(i, 1);
  }
  return chosen;
}
