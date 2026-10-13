/**
 * The target-independent half of the search: every distinct sum of a build's five rolls,
 * built once per archetype list + owned inventory + exotic and cached by the worker.
 */
import type { ArmorArchetype } from "../../armory/archetypes";
import { t5RollStats, t5Rolls } from "../../armory/t5-rolls";
import { NUM_SLOTS, NUM_STATS, UNIT } from "./feasibility";
import type { OwnedRoll, TheoryExotic, TheoryRoll } from "./types";

/** Bits per stat in a packed sum (five pieces reach at most 30 units). */
const PACK_BITS = 5;
/** Ways to make a sum (exotic roll + the rest) tried when looking for owned pieces. */
const MAX_WAYS = 400;

/** Every (archetype, tertiary) roll. */
export function theoryRolls(archetypes: ArmorArchetype[]): TheoryRoll[] {
  return t5Rolls(archetypes).map(({ archetype, tertiary }) => ({
    archetype: archetype.name,
    primary: archetype.primary,
    secondary: archetype.secondary,
    tertiary,
  }));
}

/** A roll's masterworked stats, in units. */
export function rollUnits(r: TheoryRoll): number[] {
  return t5RollStats(r.primary, r.secondary, r.tertiary).map((v) => v / UNIT);
}

const pack = (units: number[]): number => {
  let key = 0;
  for (let s = NUM_STATS - 1; s >= 0; s--) key = key * (1 << PACK_BITS) + units[s];
  return key;
};

/**
 * Every distinct sum of the build's five rolls, with the most pieces of it an owned piece
 * could fill (slots distinct, tuned stat and sets ignored — an upper bound the recipe step
 * makes exact).
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
 * One way to make a sum: the exotic's roll (if the build has one, with the owned copy of
 * it, if any) and the other rolls (roll indices).
 */
export interface Way {
  exotic: { roll: number; ownedId?: string } | null;
  legs: number[];
}

/** The ways to make a sum, up to MAX_WAYS of them. */
export function waysToMake(units: number[], space: TheorySpace): Way[] {
  const target = pack(units);
  const found: Way[] = [];
  const stack: number[] = [];
  let exotic: Way["exotic"] = null;
  const walk = (rem: number, left: number, from: number) => {
    if (found.length >= MAX_WAYS) return;
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
    for (const roll of space.exotic.rolls) {
      const rem = target - space.rollKeys[roll];
      if (!space.partial[NUM_SLOTS - 1].has(rem)) continue;
      exotic = { roll, ownedId: space.exotic.owned.get(roll) };
      walk(rem, NUM_SLOTS - 1, 0);
    }
  } else {
    walk(target, NUM_SLOTS, 0);
  }
  return found;
}
