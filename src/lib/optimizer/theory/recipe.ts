/**
 * From a scanned sum to cards: concrete mods and tunings, the rolls that make the sum,
 * and the owned pieces that can fill some of it.
 */
import type { SetRequirement, StatArray } from "../types";
import { clampStat, FREE, MAX_TUNINGS, NUM_SLOTS, NUM_STATS, STAT_CAP, UNIT } from "./feasibility";
import { waysToMake, type TheorySpace, type Way } from "./space";
import type {
  TheoryFocus,
  TheoryInput,
  TheoryPiece,
  TheoryRecipe,
  TheoryTuning,
} from "./types";

/** Bits per set's remaining-piece count in placeOwned's memo key. */
const SET_BITS = 3;

/** A scanned candidate: one sum and the focus it is kept for. */
export interface Candidate {
  index: number;
  focus: TheoryFocus;
  /** The focus stat's net unit gain (stat focus only). */
  gain: number;
  /** Ranking value: the focus stat's final value, −tunings for "flexible", −miss for "close". */
  value: number;
  tunings: number;
  /** Tie-break: the clamped armor + constants total (less lost to the 0/200 clamp). */
  spread: number;
}

/** What every recipe of one solve shares. */
export interface RecipeContext {
  input: TheoryInput;
  space: TheorySpace;
  /** Units each stat must gain from the armor (FREE without a target). */
  c: number[];
  /** Fragments + the exotic's bonus. */
  constant: StatArray;
}

/**
 * Concrete mods + tunings for one candidate, then the rolls (owned where possible): up to
 * `ways` builds, one per archetype mix that makes the sum, best first. A close candidate
 * leaves short what tuning can't cover instead of failing.
 */
export function recipeBuilder({ input, space, c, constant }: RecipeContext) {
  const { major, minor } = input.mods;
  return (p: Candidate, ways: number): TheoryRecipe[] => {
    const allowShort = p.focus === "close";
    const focus = typeof p.focus === "number" ? p.focus : -1;
    const units = Array.from(space.units.subarray(p.index * NUM_STATS, (p.index + 1) * NUM_STATS));
    const g = c.map((v, s) => (v <= FREE ? FREE : v - units[s]));
    if (focus >= 0) g[focus] = p.gain;

    // What each stat must keep: its target, or for the focus stat the value the scan
    // proved it reaches (so the build never gives its own maxed stat away as a donor).
    const floor = (s: number) =>
      s === focus
        ? Math.min(STAT_CAP, constant[s] + UNIT * (units[s] + p.gain))
        : input.minimums[s];

    /**
     * Mods and tunings for the sum. Mods go greedily as tuningsNeeded counts them, then
     * each unit still short is tuned in from the stat with the most room. `prefer[s]`
     * units of stat s's need are kept for tunings instead of mods — the same totals, but
     * tunings an owned piece's tuned stat can carry. Null when it doesn't work out.
     */
    const plan = (prefer: number[]) => {
      const need = g.map((v) => Math.max(0, v));
      let reserve = MAX_TUNINGS;
      const reserved = need.map((n, s) => {
        const r = Math.min(n, prefer[s], reserve);
        reserve -= r;
        return r;
      });
      const left = need.map((n, s) => n - reserved[s]);
      const mods: [number, number][] = Array.from({ length: NUM_STATS }, () => [0, 0]);
      const neediest = (min: number) => {
        let best = -1;
        for (let s = 0; s < NUM_STATS; s++) {
          if (left[s] >= min && (best < 0 || left[s] > left[best])) best = s;
        }
        return best;
      };
      let majors = major;
      let minors = minor;
      for (const min of [2, 1]) {
        for (let s = neediest(min); majors > 0 && s >= 0; s = neediest(min)) {
          mods[s][0]++;
          left[s] -= 2;
          majors--;
        }
      }
      for (let s = neediest(1); minors > 0 && s >= 0; s = neediest(1)) {
        mods[s][1]++;
        left[s] -= 1;
        minors--;
      }

      const value = (s: number) => constant[s] + UNIT * (units[s] + 2 * mods[s][0] + mods[s][1]);
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

      // Tunings: from a stat with nothing to keep first (lowest first, so the 0-clamp hides
      // what it can), else the one with the most spare.
      const gained = new Array(NUM_STATS).fill(0);
      const room = (s: number) =>
        floor(s) > 0 ? Math.floor((value(s) + gained[s] - floor(s)) / UNIT) : Infinity;
      const tunings: TheoryTuning[] = [];
      for (let s = 0; s < NUM_STATS; s++) {
        // A major on a reserved stat can overshoot and cover part of the reservation.
        const toTune = Math.max(0, left[s] + reserved[s]);
        for (let k = 0; k < toTune && tunings.length < MAX_TUNINGS; k++) {
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
            return null;
          }
          tunings.push({ plus: s, minus: donor });
          gained[s] += UNIT;
          gained[donor] -= UNIT;
        }
      }
      const stats = Array.from({ length: NUM_STATS }, (_, s) => clampStat(value(s) + gained[s]));
      const short = stats.map((v, s) => Math.max(0, floor(s) - v));
      if (!allowShort && short.some((v) => v > 0)) return null;
      return { mods, tunings, stats, short: stats.map((v, s) => Math.max(0, input.minimums[s] - v)) };
    };

    const made = waysToMake(units, space);
    const seat = (pl: NonNullable<ReturnType<typeof plan>>) =>
      placeOwned(made, pl.tunings, input.sets, space, ways);
    const ownedIn = (built: TheoryPiece[][]) => built[0]?.filter((piece) => piece.owned).length ?? -1;

    let chosen = plan(new Array(NUM_STATS).fill(0));
    let built = chosen ? seat(chosen) : [];
    // The greedy mods fix which stats get tuned, and an owned piece can only carry a tuning
    // on its own tuned stat. So also try keeping tunings for the tuned stats of the owned
    // pieces this sum's rolls could seat (one per slot and stat), and take whichever plan
    // seats more of them.
    const inWays = new Set(made.flatMap((w) => w.legs));
    const prefer = new Array(NUM_STATS).fill(0);
    for (const list of space.ownedBySlot) {
      for (const t of new Set(list.filter((o) => inWays.has(o.roll)).map((o) => o.tuned))) prefer[t]++;
    }
    if (prefer.some((n) => n > 0)) {
      const alt = plan(prefer);
      const altBuilt = alt ? seat(alt) : [];
      if (ownedIn(altBuilt) > ownedIn(built)) {
        chosen = alt;
        built = altBuilt;
      }
    }
    if (!chosen) return [];
    const { mods, stats, short } = chosen;
    return built.map((pieces) => recipeOf(pieces, p.focus, stats, mods, allowShort ? short : undefined));
  };
}

function recipeOf(
  pieces: TheoryPiece[],
  focus: TheoryFocus,
  stats: StatArray,
  mods: [number, number][],
  short: StatArray | undefined,
): TheoryRecipe {
  const owned = pieces.filter((piece) => piece.owned).length;
  const usedSlots = new Set(pieces.flatMap((piece) => (piece.owned ? [piece.slot] : [])));
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

/** An owned legendary seated in a way: its slot, which of the way's rolls, tuning and set. */
interface Seat {
  slot: number;
  /** Index into the way's `legs`. */
  piece: number;
  /** Index into the tunings it carries, or −1. */
  tuning: number;
  /** Index into the set requirements it counts toward, or −1. */
  set: number;
  instanceId: string;
}

/** A way with owned pieces seated in it. */
interface Seated {
  way: Way;
  seats: Seat[];
  owned: number;
  distinct: number;
}

/**
 * Seat owned pieces in each way to make the sum, and keep the best `limit`: the exotic's
 * slot takes an owned copy of its roll; every other slot at most one owned legendary whose
 * roll is still unclaimed, carrying a needed tuning when its tuned stat is one and counting
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
  const exoticSlot = space.exotic?.slot ?? -1;
  const setMask = (1 << SET_BITS) - 1;
  const initialSets = sets.reduce((code, s, i) => code + (s.count << (SET_BITS * i)), 0);
  const setsLeft = (code: number) => {
    let n = 0;
    for (let i = 0; i < sets.length; i++) n += (code >> (SET_BITS * i)) & setMask;
    return n;
  };

  const ranked: Seated[] = [];
  for (const way of ways) {
    const { legs } = way;
    const exoticCarries = way.exotic ? 1 : 0;
    const memo = new Map<number, { owned: number; seats: Seat[] } | null>();
    const go = (
      slot: number,
      usedP: number,
      usedT: number,
      setCode: number,
    ): { owned: number; seats: Seat[] } | null => {
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
    ranked.push({
      way,
      seats: seated.seats,
      owned: seated.owned + (way.exotic?.ownedId ? 1 : 0),
      distinct: new Set(way.exotic ? [...legs, way.exotic.roll] : legs).size,
    });
  }
  // Most owned, then the fewest different rolls to farm; ties keep the walk's order.
  ranked.sort((a, b) => b.owned - a.owned || a.distinct - b.distinct);
  return ranked.slice(0, limit).map((best) => seat(best, tunings, sets, space));
}

/** The pieces for one seated way: owned seats, then the exotic, then farmed in open slots. */
function seat(
  { way, seats }: Seated,
  tunings: TheoryTuning[],
  sets: SetRequirement[],
  space: TheorySpace,
): TheoryPiece[] {
  const exoticSlot = space.exotic?.slot ?? -1;
  // Slots are filled in below; -1 until then.
  const legs: TheoryPiece[] = way.legs.map((r) => ({ ...space.rolls[r], slot: -1, tuning: null }));
  const usedT = new Set<number>();
  const setCounts = sets.map((s) => s.count);
  for (const s of seats) {
    const piece = legs[s.piece];
    piece.owned = { instanceId: s.instanceId };
    piece.slot = s.slot;
    if (s.tuning >= 0) {
      piece.tuning = tunings[s.tuning];
      usedT.add(s.tuning);
    }
    if (s.set >= 0) {
      piece.setHash = sets[s.set].setHash;
      setCounts[s.set]--;
    }
  }
  const tuningsLeft = tunings.filter((_, i) => !usedT.has(i));
  const exoticPiece: TheoryPiece | null = way.exotic
    ? {
        ...space.rolls[way.exotic.roll],
        slot: exoticSlot,
        // The exotic takes a tuning first: its tuning is flexible, so it narrows no drop.
        tuning: tuningsLeft.shift() ?? null,
        exotic: true,
        owned: way.exotic.ownedId ? { instanceId: way.exotic.ownedId } : undefined,
      }
    : null;
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
