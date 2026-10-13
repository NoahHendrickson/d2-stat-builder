/**
 * Theoretical builds: the five Tier-5 rolls (archetype, tertiary, tuned stat) that reach
 * the stat targets with the chosen exotic, set bonuses, mods and fragments — no owned
 * armor needed.
 *
 * Every masterworked Tier-5 piece is 30 / 25 / 20 / 5 / 5 / 5, so all stat values move in
 * steps of 5 and the whole search works in those units. A build's armor is then just its
 * summed roll vector; there are ~600k distinct sums of five rolls (12 archetypes × 4
 * tertiaries), built once per archetype list + owned inventory + exotic and cached
 * (`TheorySpace`). Per query, each sum is checked in closed form (`tuningsNeeded`): mods
 * are placed greedily, and what's still short has to come from directional tunings — at
 * most one per piece, each moving one unit from a stat with room to spare.
 *
 * The exotic is one of the five rolls, held to its slot (an exotic class item to the
 * rolls its Spirits allow); its def-level stat bonus is a constant like the fragments,
 * and its tuning is flexible, so it takes a tuning without narrowing a drop. Set bonuses
 * are perks, not stats: any roll can come from any set, so a set requirement only says
 * which pieces must come from it — which matters for the owned pieces a build can use.
 *
 * Spare points are where builds differ, so each stat gets its own builds that max it
 * (the list's stat sort brings up the one the player wants), plus builds that need the
 * fewest tuned pieces (easiest to farm). Owned pieces with the exact roll fill their slot.
 *
 * Pure — no DOM/React deps, so it runs in a Web Worker and in Node tests.
 */
import type { ArmorArchetype } from "../armory/archetypes";
import type { ModBudget, SetRequirement, StatArray } from "./types";

const NUM_SLOTS = 5;
const NUM_STATS = 6;
/** Every Tier-5 stat value is a multiple of this. */
const UNIT = 5;
const STAT_CAP = 200;
/** Masterworked Tier-5 roll values, in units: 30 / 25 / 20, and 5 on the other three. */
const PRIMARY_UNITS = 6;
const SECONDARY_UNITS = 5;
const TERTIARY_UNITS = 4;
const OFF_UNITS = 1;
/** Bits per stat in a packed sum (five pieces reach at most 30 units). */
const PACK_BITS = 5;
/** A stat with no target: it can give away any number of units. */
const FREE = -1_000_000;
/** One directional tuning per piece. */
const MAX_TUNINGS = NUM_SLOTS;
/** Bits per set's remaining-piece count in placeOwned's memo key. */
const SET_BITS = 3;

/** Builds kept per (focus, owned count) while scanning, before the owned/value trade-off. */
const KEEP_PER_LEVEL = 4;
/** Builds listed per focus (each stat, and fewest tuned pieces). */
const KEEP_PER_FOCUS = 6;
/** Ways to make a sum (exotic roll + the rest) tried when looking for owned pieces. */
const MAX_MULTISETS = 400;
/**
 * Below this many builds the list is filled out: first with other archetype mixes that
 * land on the same stats, then (separately) with close builds that just miss.
 */
const FEW_BUILDS = 12;
/** Other archetype mixes tried per build when filling out a short list. */
const ALTERNATE_WAYS = 4;
/** A close build misses the targets by at most this many units (5 points each). */
const CLOSE_UNITS = 4;
/** Close builds kept while scanning, and listed. */
const CLOSE_KEEP = 24;
const CLOSE_SHOWN = 6;

/** One farmable roll: an archetype and its tertiary stat. */
export interface TheoryRoll {
  archetype: string;
  primary: number;
  secondary: number;
  tertiary: number;
}

/** An owned Tier-5 legendary, reduced to what makes it interchangeable with a farmed roll. */
export interface OwnedRoll {
  instanceId: string;
  /** Index into ARMOR_SLOTS. */
  slot: number;
  archetype: string;
  tertiary: number;
  /** The rolled tuned stat (where its directional tuning puts the +5). */
  tuned: number;
  setHash?: number;
}

/** The exotic a theoretical build wears, in its own slot. */
export interface TheoryExotic {
  /** Index into ARMOR_SLOTS. */
  slot: number;
  /** The rolls it can drop with; null = any archetype and tertiary. */
  rolls: { archetype: string; tertiary: number }[] | null;
  /** The def-level stat bonus a Tier-5 copy adds (zeros when there's none). */
  intrinsic: StatArray;
  /** Owned Tier-5 copies. Their tuning is flexible, so the tuned stat doesn't matter. */
  owned: { instanceId: string; archetype: string; tertiary: number }[];
}

export interface TheoryInput {
  archetypes: ArmorArchetype[];
  owned: OwnedRoll[];
  minimums: StatArray;
  mods: ModBudget;
  fragmentBonus: StatArray;
  exotic: TheoryExotic | null;
  sets: SetRequirement[];
}

/** A directional tuning: +5 to `plus` (the piece's tuned stat), −5 to `minus`. */
export interface TheoryTuning {
  plus: number;
  minus: number;
}

export interface TheoryPiece extends TheoryRoll {
  /** The slot it goes in (ARMOR_SLOTS index): an owned piece's own, the exotic's, or one left open. */
  slot: number;
  /** null = any tuned stat will do (the piece needs no tuning). */
  tuning: TheoryTuning | null;
  /** The owned piece that already has this roll, and its slot (ARMOR_SLOTS index). */
  owned?: { instanceId: string; slot: number };
  /** The build's exotic (its tuning is flexible: any +5). */
  exotic?: true;
  /** The required set this piece counts toward. */
  setHash?: number;
}

/** What a build spends its spare points on: one stat (index), or fewest tuned pieces. */
export type TheoryFocus = number | "flexible" | "close";

export interface TheoryRecipe {
  /** Stable identity: the rolls, their tunings and sets, and the final stats. */
  key: string;
  focus: TheoryFocus;
  /** One per slot, in slot order (helmet, arms, chest, legs, class item). */
  pieces: TheoryPiece[];
  /** Final stats after mods, tuning, fragments and the exotic's bonus, clamped to 0–200. */
  stats: StatArray;
  total: number;
  /** Stat mods per stat: [majors, minors]. */
  mods: [number, number][];
  /** Pieces already owned. */
  owned: number;
  /** Legendaries that need a particular tuned stat (the exotic's tuning is flexible). */
  tuned: number;
  /** Slots no owned piece fills (ARMOR_SLOTS indices) — the farmed pieces go here. */
  openSlots: number[];
  /** Close builds only: points short of each stat's target (0 where it's met). */
  short?: StatArray;
}

export interface TheoryResult {
  recipes: TheoryRecipe[];
  /**
   * Max reachable value per stat with the OTHER stats at their targets (each stat's own
   * target ignored), exact. All zero when the other targets can't be met at all.
   */
  ceilings: StatArray;
  /** The set bonuses need more pieces than the build has to give them. */
  setsDontFit: boolean;
  /**
   * When there are few builds: ones that miss the targets by a few points, fewest missed
   * first. Empty otherwise.
   */
  close: TheoryRecipe[];
}

/** Every (archetype, tertiary) roll. */
export function theoryRolls(archetypes: ArmorArchetype[]): TheoryRoll[] {
  const out: TheoryRoll[] = [];
  for (const a of archetypes) {
    for (let tertiary = 0; tertiary < NUM_STATS; tertiary++) {
      if (tertiary === a.primary || tertiary === a.secondary) continue;
      out.push({ archetype: a.name, primary: a.primary, secondary: a.secondary, tertiary });
    }
  }
  return out;
}

/** A roll's masterworked stats, in units. */
export function rollUnits(r: TheoryRoll): number[] {
  const u = new Array(NUM_STATS).fill(OFF_UNITS);
  u[r.primary] = PRIMARY_UNITS;
  u[r.secondary] = SECONDARY_UNITS;
  u[r.tertiary] = TERTIARY_UNITS;
  return u;
}

const pack = (units: number[]): number => {
  let key = 0;
  for (let s = NUM_STATS - 1; s >= 0; s--) key = key * (1 << PACK_BITS) + units[s];
  return key;
};

/**
 * The target-independent half of the search: every distinct sum of the build's five
 * rolls, with the most pieces of it an owned piece could fill (slots distinct, tuned stat
 * and sets ignored — an upper bound the build step makes exact).
 */
export interface TheorySpace {
  rolls: TheoryRoll[];
  rollKeys: number[];
  /** Distinct packed sums of k rolls (any rolls), k = 0..4 — to rebuild a sum's rolls. */
  partial: Set<number>[];
  count: number;
  /** count × 6 units per stat. */
  units: Uint8Array;
  ownedBound: Uint8Array;
  /** Per slot, the owned legendaries there: one per (roll, tuned stat, set). */
  ownedBySlot: { roll: number; tuned: number; setHash?: number; instanceId: string }[][];
  /** The exotic's slot, the rolls it can take, and owned copies by roll. */
  exotic: { slot: number; rolls: number[]; owned: Map<number, string> } | null;
}

export function buildTheorySpace(
  archetypes: ArmorArchetype[],
  owned: OwnedRoll[],
  exotic: Pick<TheoryExotic, "slot" | "rolls" | "owned"> | null = null,
): TheorySpace {
  const rolls = theoryRolls(archetypes);
  const rollKeys = rolls.map((r) => pack(rollUnits(r)));
  const rollIndex = new Map(rolls.map((r, i) => [`${r.archetype}:${r.tertiary}`, i]));
  const indexOf = (r: { archetype: string; tertiary: number }) =>
    rollIndex.get(`${r.archetype}:${r.tertiary}`);
  const allRolls = rolls.map((_, i) => i);

  // The exotic's slot holds only the exotic; owned legendaries there can't be used.
  let exoticSpace: TheorySpace["exotic"] = null;
  if (exotic) {
    const allowed = exotic.rolls
      ? [...new Set(exotic.rolls.flatMap((r) => indexOf(r) ?? []))]
      : allRolls;
    const ownedCopies = new Map<number, string>();
    for (const o of exotic.owned) {
      const roll = indexOf(o);
      if (roll !== undefined && allowed.includes(roll) && !ownedCopies.has(roll)) {
        ownedCopies.set(roll, o.instanceId);
      }
    }
    exoticSpace = { slot: exotic.slot, rolls: allowed, owned: ownedCopies };
  }

  const ownedBySlot = Array.from(
    { length: NUM_SLOTS },
    () => [] as TheorySpace["ownedBySlot"][number],
  );
  const seen = new Set<string>();
  for (const o of owned) {
    const roll = indexOf(o);
    if (roll === undefined || o.slot < 0 || o.slot >= NUM_SLOTS) continue;
    if (o.slot === exoticSpace?.slot) continue;
    const id = `${o.slot}:${roll}:${o.tuned}:${o.setHash ?? 0}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ownedBySlot[o.slot].push({ roll, tuned: o.tuned, setHash: o.setHash, instanceId: o.instanceId });
  }
  const ownedAt = ownedBySlot.map((list, slot) =>
    slot === exoticSpace?.slot
      ? new Set(exoticSpace.owned.keys())
      : new Set(list.map((o) => o.roll)),
  );

  // Sums of k rolls in any order, for rebuilding a sum's rolls.
  const partial: Set<number>[] = [new Set([0])];
  for (let k = 1; k < NUM_SLOTS; k++) {
    const next = new Set<number>();
    for (const key of partial[k - 1]) for (const rk of rollKeys) next.add(key + rk);
    partial.push(next);
  }

  // Slot by slot: the sums reachable so far, each with the most owned pieces in it.
  let level = new Map<number, number>([[0, 0]]);
  for (let slot = 0; slot < NUM_SLOTS; slot++) {
    const choices = slot === exoticSpace?.slot ? exoticSpace.rolls : allRolls;
    const next = new Map<number, number>();
    for (const [key, ownedSoFar] of level) {
      for (const r of choices) {
        const k = key + rollKeys[r];
        const o = ownedSoFar + (ownedAt[slot].has(r) ? 1 : 0);
        const prev = next.get(k);
        if (prev === undefined || o > prev) next.set(k, o);
      }
    }
    level = next;
  }

  const count = level.size;
  const units = new Uint8Array(count * NUM_STATS);
  const ownedBound = new Uint8Array(count);
  const mask = (1 << PACK_BITS) - 1;
  let i = 0;
  for (const [key, o] of level) {
    let k = key;
    for (let s = 0; s < NUM_STATS; s++) {
      units[i * NUM_STATS + s] = k & mask;
      k = Math.floor(k / (1 << PACK_BITS));
    }
    ownedBound[i] = o;
    i++;
  }
  return { rolls, rollKeys, partial, count, units, ownedBound, ownedBySlot, exotic: exoticSpace };
}

/**
 * Directional tunings a build needs, or -1 if it can't reach its targets. `g[s]` is how
 * many units stat s must gain (negative = units it can give away; FREE = no target, any).
 *
 * Mods go where the need is: majors (2 units) on stats short by 2+, then majors on stats
 * short by 1, then minors. Whatever is still short (P units) has to be tuned in, one unit
 * per tuning; that works iff P ≤ 5 and there is P units of room to take them from. The
 * room left after every mod is placed is P − Σh over the residuals h, so that second
 * condition is Σg ≤ the mods' total — or always true when some stat has no target.
 */
export function tuningsNeeded(g: ArrayLike<number>, major: number, minor: number): number {
  let need = 0;
  let pairs = 0;
  let odd = 0;
  let sum = 0;
  let free = false;
  for (let s = 0; s < NUM_STATS; s++) {
    const v = g[s];
    if (v <= FREE) {
      free = true;
      continue;
    }
    sum += v;
    if (v > 0) {
      need += v;
      pairs += v >> 1;
      odd += v & 1;
    }
  }
  if (!free && sum > 2 * major + minor) return -1;
  const short =
    major <= pairs
      ? need - 2 * major - minor
      : odd - Math.min(major - pairs, odd) - minor;
  const p = Math.max(0, short);
  return p <= MAX_TUNINGS ? p : -1;
}

/**
 * For a build that can't reach its targets: the fewest units it falls short by in total.
 * The same greedy mods as tuningsNeeded, then tunings cover what they can (at most 5, and
 * no more than there is room to take from).
 */
export function shortfall(g: ArrayLike<number>, major: number, minor: number): number {
  let need = 0;
  let pairs = 0;
  let odd = 0;
  let sum = 0;
  let free = false;
  for (let s = 0; s < NUM_STATS; s++) {
    const v = g[s];
    if (v <= FREE) {
      free = true;
      continue;
    }
    sum += v;
    if (v > 0) {
      need += v;
      pairs += v >> 1;
      odd += v & 1;
    }
  }
  const short = Math.max(
    0,
    major <= pairs ? need - 2 * major - minor : odd - Math.min(major - pairs, odd) - minor,
  );
  // Room to tune from: the residuals' negative parts, short − Σh after every mod.
  const room = free ? Infinity : Math.max(0, short - (sum - 2 * major - minor));
  return short - Math.min(short, MAX_TUNINGS, room);
}

/** Units a stat must gain to reach its target from the armor (FREE without a target). */
function constants(minimums: StatArray, constant: StatArray): number[] {
  return minimums.map((m, s) => (m > 0 ? Math.ceil((m - constant[s]) / UNIT) : FREE));
}

const clampStat = (v: number) => Math.max(0, Math.min(STAT_CAP, v));

/** A scanned candidate: one sum and the focus it is kept for. */
interface Candidate {
  index: number;
  focus: TheoryFocus;
  /** The focus stat's net unit gain (stat focus only). */
  gain: number;
  /** Ranking value: the focus stat's final value, or −tunings for "flexible". */
  value: number;
  tunings: number;
  /** Tie-break: the clamped armor + constants total (less lost to the 0/200 clamp). */
  spread: number;
}

export function solveTheory(input: TheoryInput, space: TheorySpace): TheoryResult {
  const { major, minor } = input.mods;
  // Fragments and the exotic's bonus are the same for every build.
  const constant = input.fragmentBonus.map((v, s) => v + (input.exotic?.intrinsic[s] ?? 0));
  const c = constants(input.minimums, constant);
  const g = new Int32Array(NUM_STATS);
  const ceilings = new Array(NUM_STATS).fill(0);
  const maxGain = 2 * major + minor + MAX_TUNINGS;
  const legendaries = NUM_SLOTS - (input.exotic ? 1 : 0);
  const setsDontFit = input.sets.reduce((n, s) => n + s.count, 0) > legendaries;

  // Per focus (6 stats, then "flexible") and owned count, the best few sums.
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
  const keep = (f: number, owned: number, p: Candidate) => {
    const list = kept[f][owned];
    if (list.length === KEEP_PER_LEVEL && !better(p, list[list.length - 1])) return;
    let at = list.length;
    while (at > 0 && better(p, list[at - 1])) at--;
    list.splice(at, 0, p);
    if (list.length > KEEP_PER_LEVEL) list.pop();
  };

  const { units, ownedBound } = space;
  // Close misses, fewest units short first (then most owned, least lost to the clamp).
  const close: Candidate[] = [];
  const closer = (a: Candidate, b: Candidate) =>
    a.value !== b.value
      ? a.value > b.value
      : ownedBound[a.index] !== ownedBound[b.index]
        ? ownedBound[a.index] > ownedBound[b.index]
        : a.spread > b.spread;

  for (let i = 0; i < space.count; i++) {
    const base = i * NUM_STATS;
    let spread = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      g[s] = c[s] <= FREE ? FREE : c[s] - units[base + s];
      spread += clampStat(constant[s] + UNIT * units[base + s]);
    }
    const allTunings = setsDontFit ? -1 : tuningsNeeded(g, major, minor);
    const owned = ownedBound[i];
    if (allTunings < 0 && !setsDontFit) {
      const miss = shortfall(g, major, minor);
      if (miss <= CLOSE_UNITS) {
        const p: Candidate = { index: i, focus: "close", gain: 0, value: -miss, tunings: 0, spread };
        if (close.length < CLOSE_KEEP || closer(p, close[close.length - 1])) {
          let at = close.length;
          while (at > 0 && closer(p, close[at - 1])) at--;
          close.splice(at, 0, p);
          if (close.length > CLOSE_KEEP) close.pop();
        }
      }
    }
    if (allTunings >= 0) {
      keep(NUM_STATS, owned, {
        index: i,
        focus: "flexible",
        gain: 0,
        value: -allTunings,
        tunings: allTunings,
        spread,
      });
    }
    for (let f = 0; f < NUM_STATS; f++) {
      // Largest net gain u for f (in units) that keeps the others reachable — monotone in
      // u, so a binary search from a feasible `lo`. Past `hi` the stat is at the cap.
      const own = g[f];
      const x = constant[f] + UNIT * units[base + f];
      let lo: number;
      let tunings: number;
      if (allTunings >= 0 && own > FREE) {
        // Its own target is met, so that gain is feasible.
        lo = own;
        tunings = allTunings;
      } else {
        g[f] = FREE;
        if (tuningsNeeded(g, major, minor) < 0) {
          g[f] = own;
          continue;
        }
        // Below this gain the stat is clamped to 0 anyway.
        lo = Math.floor(-x / UNIT) - 1;
        g[f] = lo;
        tunings = tuningsNeeded(g, major, minor);
        if (tunings < 0) {
          // The others only work if f gives away more than it has: f's best is 0.
          g[f] = own;
          continue;
        }
      }
      let hi = Math.max(lo, Math.min(Math.ceil((STAT_CAP - x) / UNIT), maxGain));
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        g[f] = mid;
        const t = tuningsNeeded(g, major, minor);
        if (t >= 0) {
          lo = mid;
          tunings = t;
        } else {
          hi = mid - 1;
        }
      }
      g[f] = own;
      const value = clampStat(x + UNIT * lo);
      if (value > ceilings[f]) ceilings[f] = value;
      // A build kept for this focus must meet every target, f's own included.
      if (allTunings >= 0) keep(f, owned, { index: i, focus: f, gain: lo, value, tunings, spread });
    }
  }

  // Per focus: walking from most owned pieces down, keep a build only if it beats every
  // build with more owned pieces — owning more is worth a lower value, not the reverse.
  const picks: Candidate[] = [];
  for (let f = 0; f < FOCI; f++) {
    let bestAbove = -Infinity;
    let n = 0;
    for (let owned = NUM_SLOTS; owned >= 0 && n < KEEP_PER_FOCUS; owned--) {
      const list = kept[f][owned];
      for (const p of list) {
        if (n >= KEEP_PER_FOCUS) break;
        if (p.value <= bestAbove) break;
        picks.push(p);
        n++;
      }
      if (list.length) bestAbove = Math.max(bestAbove, list[0].value);
    }
  }

  const byKey = new Map<string, TheoryRecipe>();
  const add = (recipe: TheoryRecipe) => {
    const prev = byKey.get(recipe.key);
    if (!prev || recipe.owned > prev.owned) byKey.set(recipe.key, recipe);
  };
  for (const p of picks) {
    for (const recipe of buildRecipe(p, input, space, c, constant, 1)) add(recipe);
  }
  // A short list: the same stats from other archetype mixes, best of each build first.
  if (byKey.size < FEW_BUILDS) {
    for (const p of picks) {
      for (const recipe of buildRecipe(p, input, space, c, constant, ALTERNATE_WAYS).slice(1)) {
        if (byKey.size >= FEW_BUILDS) break;
        add(recipe);
      }
    }
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
      const [recipe] = buildRecipe(p, input, space, c, constant, 1, true);
      if (!recipe || seen.has(recipe.key)) continue;
      seen.add(recipe.key);
      closeRecipes.push(recipe);
    }
  }
  return { recipes, ceilings, setsDontFit, close: closeRecipes };
}

/**
 * Concrete mods + tunings for one sum and focus, then the rolls (owned where possible):
 * up to `ways` builds, one per archetype mix that makes the sum, best first. With
 * `allowShort`, what tuning can't cover is left short (close builds) instead of failing.
 */
function buildRecipe(
  p: Candidate,
  input: TheoryInput,
  space: TheorySpace,
  c: number[],
  constant: StatArray,
  ways: number,
  allowShort = false,
): TheoryRecipe[] {
  const { major, minor } = input.mods;
  const units = Array.from(space.units.subarray(p.index * NUM_STATS, (p.index + 1) * NUM_STATS));
  const g = c.map((v, s) => (v <= FREE ? FREE : v - units[s]));
  if (typeof p.focus === "number") g[p.focus] = p.gain;

  // Mods, greedily as tuningsNeeded counts them.
  const need = g.map((v) => Math.max(0, v));
  const mods: [number, number][] = Array.from({ length: NUM_STATS }, () => [0, 0]);
  const neediest = (min: number) => {
    let best = -1;
    for (let s = 0; s < NUM_STATS; s++) {
      if (need[s] >= min && (best < 0 || need[s] > need[best])) best = s;
    }
    return best;
  };
  let majors = major;
  let minors = minor;
  for (const min of [2, 1]) {
    for (let s = neediest(min); majors > 0 && s >= 0; s = neediest(min)) {
      mods[s][0]++;
      need[s] -= 2;
      majors--;
    }
  }
  for (let s = neediest(1); minors > 0 && s >= 0; s = neediest(1)) {
    mods[s][1]++;
    need[s] -= 1;
    minors--;
  }

  const value = (s: number) =>
    constant[s] + UNIT * (units[s] + 2 * mods[s][0] + mods[s][1]);
  // Spare mods (the focus is capped, or "flexible"): raise the lowest stat under the cap.
  const lowest = () => {
    let best = -1;
    for (let s = 0; s < NUM_STATS; s++) {
      if (value(s) < STAT_CAP && (best < 0 || value(s) < value(best))) best = s;
    }
    return best;
  };
  for (let s = lowest(); majors > 0 && s >= 0; s = lowest()) {
    mods[s][0]++;
    majors--;
  }
  for (let s = lowest(); minors > 0 && s >= 0; s = lowest()) {
    mods[s][1]++;
    minors--;
  }

  // Tunings: each unit still short comes from the stat with the most room — a stat with
  // no target first (lowest first, so the 0-clamp hides what it can), else most spare.
  const gained = new Array(NUM_STATS).fill(0);
  const room = (s: number) =>
    input.minimums[s] > 0 ? Math.floor((value(s) + gained[s] - input.minimums[s]) / UNIT) : Infinity;
  const tunings: TheoryTuning[] = [];
  for (let s = 0; s < NUM_STATS; s++) {
    for (let k = 0; k < need[s] && tunings.length < MAX_TUNINGS; k++) {
      let donor = -1;
      for (let d = 0; d < NUM_STATS; d++) {
        if (d === s || room(d) <= 0) continue;
        if (donor < 0) {
          donor = d;
          continue;
        }
        const rd = room(d);
        const rb = room(donor);
        if (rd === Infinity && rb === Infinity) {
          if (value(d) + gained[d] < value(donor) + gained[donor]) donor = d;
        } else if (rd > rb) {
          donor = d;
        }
      }
      if (donor < 0) {
        if (allowShort) break;
        return [];
      }
      tunings.push({ plus: s, minus: donor });
      gained[s] += UNIT;
      gained[donor] -= UNIT;
    }
  }
  const stats = Array.from({ length: NUM_STATS }, (_, s) => clampStat(value(s) + gained[s]));
  const short = stats.map((v, s) => Math.max(0, input.minimums[s] - v));
  if (!allowShort && short.some((v) => v > 0)) return [];

  const made = rollsForSum(units, space);
  if (!made.length) return [];
  return placeOwned(made, tunings, input.sets, space, ways).map((pieces) =>
    recipeOf(pieces, p.focus, stats, mods, allowShort ? short : undefined),
  );
}

function recipeOf(
  pieces: TheoryPiece[],
  focus: TheoryFocus,
  stats: StatArray,
  mods: [number, number][],
  short: StatArray | undefined,
): TheoryRecipe {
  const owned = pieces.filter((piece) => piece.owned).length;
  const usedSlots = new Set(pieces.flatMap((piece) => (piece.owned ? [piece.owned.slot] : [])));
  const total = stats.reduce((a, b) => a + b, 0);
  const key =
    pieces
      .map(
        (piece) =>
          `${piece.exotic ? "E" : ""}${piece.archetype}:${piece.tertiary}:${piece.tuning ? `${piece.tuning.plus}>${piece.tuning.minus}` : "-"}:${piece.setHash ?? 0}:${piece.owned?.instanceId ?? ""}`,
      )
      .sort()
      .join("|") + `#${stats.join(",")}`;
  return {
    key,
    focus,
    pieces,
    stats,
    total,
    mods,
    owned,
    tuned: pieces.filter((piece) => piece.tuning && !piece.exotic).length,
    openSlots: Array.from({ length: NUM_SLOTS }, (_, s) => s).filter((s) => !usedSlots.has(s)),
    short,
  };
}

/** One way to make a sum: the exotic's roll (if the build has one) and the others'. */
interface Way {
  exotic: number | null;
  legs: number[];
}

/** The ways to make a sum (roll indices), up to MAX_MULTISETS of them. */
function rollsForSum(units: number[], space: TheorySpace): Way[] {
  const target = pack(units);
  const found: Way[] = [];
  const stack: number[] = [];
  let exotic: number | null = null;
  const walk = (rem: number, left: number, from: number) => {
    if (found.length >= MAX_MULTISETS) return;
    if (left === 0) {
      if (rem === 0) found.push({ exotic, legs: [...stack] });
      return;
    }
    for (let r = from; r < space.rolls.length; r++) {
      // A component that went negative borrows from the next, but every real k-roll sum
      // totals 18k units and a borrow adds 31, so such a key is never in the set.
      const next = rem - space.rollKeys[r];
      if (!space.partial[left - 1].has(next)) continue;
      stack.push(r);
      walk(next, left - 1, r);
      stack.pop();
    }
  };
  if (space.exotic) {
    for (const e of space.exotic.rolls) {
      const rem = target - space.rollKeys[e];
      if (!space.partial[NUM_SLOTS - 1].has(rem)) continue;
      exotic = e;
      walk(rem, NUM_SLOTS - 1, 0);
    }
  } else {
    walk(target, NUM_SLOTS, 0);
  }
  return found;
}

/**
 * Pick a way to make the sum and seat owned pieces in it: the exotic's slot takes an
 * owned copy of its roll; every other slot at most one owned legendary whose roll is
 * still unclaimed, carrying a needed tuning when its tuned stat is one and counting
 * toward a required set when it's from one. The farmed pieces (and the exotic, whose
 * tuning is flexible) carry the remaining tunings, and the farmed legendaries fill the
 * remaining set pieces — so neither may outnumber them.
 */
function placeOwned(
  ways: Way[],
  tunings: TheoryTuning[],
  sets: SetRequirement[],
  space: TheorySpace,
  limit: number,
): TheoryPiece[][] {
  type Seat = { slot: number; piece: number; tuning: number; set: number; instanceId: string };
  type Placed = { owned: number; seats: Seat[] };
  const exoticSlot = space.exotic?.slot ?? -1;
  const setMask = (1 << SET_BITS) - 1;
  const initialSets = sets.reduce((code, s, i) => code + (s.count << (SET_BITS * i)), 0);
  const setsLeft = (code: number) => {
    let n = 0;
    for (let i = 0; i < sets.length; i++) n += (code >> (SET_BITS * i)) & setMask;
    return n;
  };

  const ranked: { owned: number; distinct: number; way: Way; seats: Seat[] }[] = [];
  for (const way of ways) {
    const { legs } = way;
    const exoticOwned = way.exotic !== null && space.exotic!.owned.has(way.exotic);
    const exoticCarries = way.exotic !== null ? 1 : 0;
    const memo = new Map<number, Placed | null>();
    const go = (slot: number, usedP: number, usedT: number, setCode: number): Placed | null => {
      if (slot === NUM_SLOTS) {
        const farmed = legs.length - popcount(usedP);
        const tuningsLeft = tunings.length - popcount(usedT);
        return tuningsLeft <= farmed + exoticCarries && setsLeft(setCode) <= farmed
          ? { owned: 0, seats: [] }
          : null;
      }
      if (slot === exoticSlot) return go(slot + 1, usedP, usedT, setCode);
      const memoKey = slot + 8 * (usedP + 32 * (usedT + 32 * setCode));
      if (memo.has(memoKey)) return memo.get(memoKey)!;
      let out = go(slot + 1, usedP, usedT, setCode);
      for (const o of space.ownedBySlot[slot]) {
        const pi = legs.findIndex((r, i) => r === o.roll && !(usedP & (1 << i)));
        if (pi < 0) continue;
        const ti = tunings.findIndex((t, i) => t.plus === o.tuned && !(usedT & (1 << i)));
        const si = sets.findIndex(
          (s, i) => s.setHash === o.setHash && ((setCode >> (SET_BITS * i)) & setMask) > 0,
        );
        const rest = go(
          slot + 1,
          usedP | (1 << pi),
          ti >= 0 ? usedT | (1 << ti) : usedT,
          si >= 0 ? setCode - (1 << (SET_BITS * si)) : setCode,
        );
        if (rest && (!out || rest.owned + 1 > out.owned)) {
          out = {
            owned: rest.owned + 1,
            seats: [{ slot, piece: pi, tuning: ti, set: si, instanceId: o.instanceId }, ...rest.seats],
          };
        }
      }
      memo.set(memoKey, out);
      return out;
    };
    const seated = go(0, 0, 0, initialSets);
    if (!seated) continue;
    const owned = seated.owned + (exoticOwned ? 1 : 0);
    const distinct = new Set(way.exotic === null ? legs : [...legs, way.exotic]).size;
    ranked.push({ owned, distinct, way, seats: seated.seats });
  }
  // Most owned, then the fewest different rolls to farm; ties keep the walk's order.
  ranked.sort((a, b) => b.owned - a.owned || a.distinct - b.distinct);
  return ranked.slice(0, limit).map((best) => seat(best, tunings, sets, space));
}

/** The pieces for one seated way: owned seats, then the exotic, then farmed in open slots. */
function seat(
  best: { way: Way; seats: { slot: number; piece: number; tuning: number; set: number; instanceId: string }[] },
  tunings: TheoryTuning[],
  sets: SetRequirement[],
  space: TheorySpace,
): TheoryPiece[] {
  const exoticSlot = space.exotic?.slot ?? -1;

  // Slots are filled in below; -1 until then.
  const legs: TheoryPiece[] = best.way.legs.map((r) => ({ ...space.rolls[r], slot: -1, tuning: null }));
  const usedT = new Set<number>();
  const setCounts = sets.map((s) => s.count);
  for (const seat of best.seats) {
    const piece = legs[seat.piece];
    piece.owned = { instanceId: seat.instanceId, slot: seat.slot };
    piece.slot = seat.slot;
    if (seat.tuning >= 0) {
      piece.tuning = tunings[seat.tuning];
      usedT.add(seat.tuning);
    }
    if (seat.set >= 0) {
      piece.setHash = sets[seat.set].setHash;
      setCounts[seat.set]--;
    }
  }
  const tuningsLeft = tunings.filter((_, i) => !usedT.has(i));
  let exoticPiece: TheoryPiece | null = null;
  if (best.way.exotic !== null) {
    const e = best.way.exotic;
    const instanceId = space.exotic!.owned.get(e);
    exoticPiece = {
      ...space.rolls[e],
      slot: exoticSlot,
      // The exotic takes a tuning first: its tuning is flexible, so it narrows no drop.
      tuning: tuningsLeft.shift() ?? null,
      exotic: true,
      owned: instanceId ? { instanceId, slot: exoticSlot } : undefined,
    };
  }
  // The farmed legendaries take the slots nothing owned (or the exotic) fills, in order —
  // tuned pieces first, then by archetype, so the list reads the same build to build.
  const taken = new Set(legs.flatMap((p) => (p.owned ? [p.slot] : [])));
  if (exoticPiece) taken.add(exoticSlot);
  const open = Array.from({ length: NUM_SLOTS }, (_, i) => i).filter((i) => !taken.has(i));
  const farmed = legs.filter((p) => !p.owned);
  for (const piece of farmed) {
    if (tuningsLeft.length) piece.tuning = tuningsLeft.shift()!;
    const si = setCounts.findIndex((n) => n > 0);
    if (si >= 0) {
      piece.setHash = sets[si].setHash;
      setCounts[si]--;
    }
  }
  farmed
    .sort(
      (a, b) =>
        Number(!!b.tuning) - Number(!!a.tuning) || a.archetype.localeCompare(b.archetype),
    )
    .forEach((piece, i) => (piece.slot = open[i]));
  return [...(exoticPiece ? [exoticPiece] : []), ...legs].sort((a, b) => a.slot - b.slot);
}

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}
