/**
 * Theoretical builds: the five Tier-5 rolls (archetype, tertiary, tuned stat) that reach
 * the stat targets with the chosen exotic, set bonuses, mods and fragments — no owned
 * armor needed.
 *
 * Every masterworked Tier-5 piece is 30 / 25 / 20 / 5 / 5 / 5, so all stat values move in
 * steps of 5 and the whole search works in those units. A build's armor is then just its
 * summed roll vector; there are ~600k distinct sums of five rolls (12 archetypes × 4
 * tertiaries), built once per archetype list + owned inventory + exotic and cached
 * (space.ts). Per query, each sum is checked in closed form (feasibility.ts): mods are
 * placed greedily, and what's still short has to come from directional tunings — at most
 * one per piece, each moving one unit from a stat with room to spare.
 *
 * The exotic is one of the five rolls, held to its slot (an exotic class item to the
 * rolls its Spirits allow); its def-level stat bonus is a constant like the fragments,
 * and its tuning is flexible, so it takes a tuning without narrowing a drop. Set bonuses
 * are perks, not stats: any roll can come from any set, so a set requirement only says
 * which pieces must come from it — which matters for the owned pieces a build can use.
 *
 * Spare points are where builds differ, so each stat gets its own builds that max it
 * (the list's stat sort brings up the one the player wants), plus builds that need the
 * fewest tuned pieces (easiest to farm). Owned pieces with the exact roll fill their slot
 * (recipe.ts).
 *
 * Pure — no DOM/React deps, so it runs in a Web Worker and in Node tests.
 */
import {
  clampStat,
  unitsToGain,
  FREE,
  MAX_TUNINGS,
  NUM_SLOTS,
  NUM_STATS,
  STAT_CAP,
  tuningsNeeded,
  UNIT,
} from "./feasibility";
import { recipeBuilder, type Candidate } from "./recipe";
import type { TheorySpace } from "./space";
import type { TheoryInput, TheoryRecipe, TheoryResult } from "./types";

export { buildTheorySpace, type TheorySpace } from "./space";
export type * from "./types";

/** Builds kept per (focus, owned-count bound) while scanning. */
const KEEP_PER_LEVEL = 4;
/** Builds listed per focus (each stat, and fewest tuned pieces). */
const KEEP_PER_FOCUS = 6;
/**
 * Below this many builds the list is filled out: first with other archetype mixes that
 * land on the same stats, then (separately) with close builds that just miss.
 */
const FEW_BUILDS = 12;
/** Archetype mixes built per pick: the best, and alternates for a short list. */
const ALTERNATE_WAYS = 4;
/** A close build misses the targets by at most this many units (5 points each). */
const CLOSE_UNITS = 4;
/** Close builds kept while scanning, and listed. */
const CLOSE_KEEP = 24;
const CLOSE_SHOWN = 6;

/** Insert into a list kept sorted by `better` (best first), at most `cap` long. */
function insertBounded<T>(list: T[], item: T, cap: number, better: (a: T, b: T) => boolean) {
  if (list.length === cap && !better(item, list[cap - 1])) return;
  let at = list.length;
  while (at > 0 && better(item, list[at - 1])) at--;
  list.splice(at, 0, item);
  if (list.length > cap) list.pop();
}

export function solveTheory(input: TheoryInput, space: TheorySpace): TheoryResult {
  // The scan below runs ~4M feasibility checks: read the shared constants and check once,
  // as locals, rather than through the module binding on every one.
  const needed = tuningsNeeded;
  const N = NUM_STATS;
  const U = UNIT;
  const free = FREE;
  const clamp = clampStat;
  const cap = STAT_CAP;
  const { major, minor } = input.mods;
  // Fragments and the exotic's bonus are the same for every build.
  const constant = input.fragmentBonus.map((v, s) => v + (input.exotic?.intrinsic[s] ?? 0));
  const c = unitsToGain(input.minimums, constant);
  const g = new Int32Array(NUM_STATS);
  const ceilings = new Array(NUM_STATS).fill(0);
  const maxGain = 2 * major + minor + MAX_TUNINGS;
  const legendaries = NUM_SLOTS - (input.exotic ? 1 : 0);
  const setsDontFit = input.sets.reduce((n, s) => n + s.count, 0) > legendaries;
  // No build can exist, so there's nothing to scan.
  if (setsDontFit) return { recipes: [], ceilings, setsDontFit, close: [] };
  const { units, ownedBound } = space;

  // Per focus (6 stats, then "flexible") and owned-count bound, the best few sums.
  const FOCI = NUM_STATS + 1;
  const kept: Candidate[][][] = Array.from({ length: FOCI }, () =>
    Array.from({ length: NUM_SLOTS + 1 }, () => []),
  );
  const better = (a: Candidate, b: Candidate) =>
    a.value !== b.value
      ? a.value > b.value
      : a.tunings !== b.tunings
        ? a.tunings < b.tunings
        : a.spread > b.spread;
  // Close misses, fewest units short first (then most owned, least lost to the clamp).
  const close: Candidate[] = [];
  const closer = (a: Candidate, b: Candidate) =>
    a.value !== b.value
      ? a.value > b.value
      : ownedBound[a.index] !== ownedBound[b.index]
        ? ownedBound[a.index] > ownedBound[b.index]
        : a.spread > b.spread;

  for (let i = 0; i < space.count; i++) {
    const base = i * N;
    let spread = 0;
    for (let s = 0; s < N; s++) {
      g[s] = c[s] <= free ? free : c[s] - units[base + s];
      spread += clamp(constant[s] + U * units[base + s]);
    }
    // ≥ 0: tunings to reach every target; < 0: −(units short).
    const allTunings = needed(g, major, minor);
    const owned = ownedBound[i];
    if (allTunings < 0 && allTunings >= -CLOSE_UNITS) {
      insertBounded(
        close,
        { index: i, focus: "close", gain: 0, value: allTunings, tunings: 0, spread },
        CLOSE_KEEP,
        closer,
      );
    }
    if (allTunings >= 0) {
      insertBounded(
        kept[N][owned],
        { index: i, focus: "flexible", gain: 0, value: -allTunings, tunings: allTunings, spread },
        KEEP_PER_LEVEL,
        better,
      );
    }
    for (let f = 0; f < N; f++) {
      // Largest net gain u for f (in units) that keeps the others reachable — monotone in
      // u, so a binary search from a feasible `lo`. Past `hi` the stat is at the cap.
      const own = g[f];
      const x = constant[f] + U * units[base + f];
      let lo: number;
      let tunings: number;
      if (allTunings >= 0 && own > free) {
        // Its own target is met, so that gain is feasible.
        lo = own;
        tunings = allTunings;
      } else {
        g[f] = free;
        if (needed(g, major, minor) < 0) {
          g[f] = own;
          continue;
        }
        // Below this gain the stat is clamped to 0 anyway.
        lo = Math.floor(-x / U) - 1;
        g[f] = lo;
        tunings = needed(g, major, minor);
        if (tunings < 0) {
          // The others only work if f gives away more than it has: f's best is 0.
          g[f] = own;
          continue;
        }
      }
      let hi = Math.max(lo, Math.min(Math.ceil((cap - x) / U), maxGain));
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        g[f] = mid;
        const t = needed(g, major, minor);
        if (t >= 0) {
          lo = mid;
          tunings = t;
        } else {
          hi = mid - 1;
        }
      }
      g[f] = own;
      const value = clamp(x + U * lo);
      if (value > ceilings[f]) ceilings[f] = value;
      // A build kept for this focus must meet every target, f's own included.
      if (allTunings >= 0) {
        insertBounded(
          kept[f][owned],
          { index: i, focus: f, gain: lo, value, tunings, spread },
          KEEP_PER_LEVEL,
          better,
        );
      }
    }
  }

  const build = recipeBuilder({ input, space, c, constant });
  // Per focus, every kept sum is built (best mix plus alternates), then ranked on the
  // owned pieces its build actually seats — the scan's count is only a bound. Walking
  // from most owned down, a build is kept only if it beats every build with more owned:
  // owning more is worth a lower value, not the reverse.
  const alternates: TheoryRecipe[] = [];
  // By key, so a build another focus already listed isn't listed twice.
  const byKey = new Map<string, TheoryRecipe>();
  for (let f = 0; f < FOCI; f++) {
    const built = kept[f]
      .flat()
      .flatMap((p) => {
        const recipes = build(p, ALTERNATE_WAYS);
        return recipes.length ? [{ p, recipes }] : [];
      })
      .sort(
        (a, b) =>
          b.recipes[0].owned - a.recipes[0].owned ||
          (better(a.p, b.p) ? -1 : better(b.p, a.p) ? 1 : 0),
      );
    let bestAbove = -Infinity;
    let groupOwned = Infinity;
    let groupBest = -Infinity;
    let n = 0;
    for (const { p, recipes } of built) {
      if (n >= KEEP_PER_FOCUS) break;
      if (recipes[0].owned !== groupOwned) {
        bestAbove = Math.max(bestAbove, groupBest);
        groupOwned = recipes[0].owned;
        groupBest = -Infinity;
      }
      groupBest = Math.max(groupBest, p.value);
      if (p.value <= bestAbove || byKey.has(recipes[0].key)) continue;
      byKey.set(recipes[0].key, recipes[0]);
      alternates.push(...recipes.slice(1));
      n++;
    }
  }
  // A short list: the same stats from other archetype mixes, best of each build first.
  for (const recipe of alternates) {
    if (byKey.size >= FEW_BUILDS) break;
    if (!byKey.has(recipe.key)) byKey.set(recipe.key, recipe);
  }
  const recipes = [...byKey.values()].sort(
    (a, b) => b.owned - a.owned || a.tuned - b.tuned || b.total - a.total,
  );

  // Still short: the builds that come closest without making it.
  const closeRecipes: TheoryRecipe[] = [];
  if (recipes.length < FEW_BUILDS) {
    const seen = new Set<string>();
    for (const p of close) {
      if (closeRecipes.length >= CLOSE_SHOWN) break;
      const [recipe] = build(p, 1);
      if (!recipe || seen.has(recipe.key)) continue;
      seen.add(recipe.key);
      closeRecipes.push(recipe);
    }
  }
  return { recipes, ceilings, setsDontFit, close: closeRecipes };
}
