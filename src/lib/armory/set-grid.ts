/**
 * Set coverage grid: for one armor set and archetype, how many owned pieces sit in each
 * slot × tertiary stat, and which tuned stats they carry — so a player can see which
 * rolls of a set they still need to farm.
 *
 * Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
 */
import type { ArmorArchetype } from "./archetypes";
import type { ArmorPiece } from "./normalize";
import {
  ARMOR_SLOTS,
  STAT_DISPLAY_ORDER,
  STAT_ORDER,
  tertiaryStatIndex,
} from "./stats";

export interface SetGridCell {
  count: number;
  /** Tuned stats (STAT_ORDER indices) among the counted pieces, ascending. */
  tuned: number[];
}

export interface SetGrid {
  /** The archetype's four possible tertiaries (STAT_ORDER indices), in display order. */
  columns: number[];
  /** One row per slot (ARMOR_SLOTS order), one cell per column. */
  rows: SetGridCell[][];
}

type GridPiece = Pick<ArmorPiece, "slot" | "setHash" | "archetype" | "baseStats" | "tunedStat">;

/** The four stats an archetype can roll as tertiary, in the UI's stat order. */
export function tertiaryColumns(archetype: ArmorArchetype): number[] {
  return STAT_DISPLAY_ORDER.map((key) => STAT_ORDER.indexOf(key)).filter(
    (s) => s !== archetype.primary && s !== archetype.secondary,
  );
}

/**
 * Count `pieces` of `setHash` rolled as `archetype` into slot × tertiary cells. With
 * `tuned` set, only pieces with that tuned stat count (untunable pieces never do).
 */
export function setArchetypeGrid(
  pieces: readonly GridPiece[],
  setHash: number,
  archetype: ArmorArchetype,
  tuned: number | null = null,
): SetGrid {
  const columns = tertiaryColumns(archetype);
  const cells = ARMOR_SLOTS.map(() =>
    columns.map(() => ({ count: 0, tuned: new Set<number>() })),
  );
  for (const p of pieces) {
    if (p.setHash !== setHash || p.archetype !== archetype.name) continue;
    if (tuned !== null && p.tunedStat !== tuned) continue;
    const col = columns.indexOf(tertiaryStatIndex(p.baseStats));
    const row = ARMOR_SLOTS.indexOf(p.slot);
    if (col < 0 || row < 0) continue;
    cells[row][col].count++;
    if (p.tunedStat !== undefined) cells[row][col].tuned.add(p.tunedStat);
  }
  return {
    columns,
    rows: cells.map((row) =>
      row.map((c) => ({ count: c.count, tuned: [...c.tuned].sort((a, b) => a - b) })),
    ),
  };
}

/** How many owned pieces of `setHash` each archetype has (archetypes with none omitted). */
export function archetypeCounts(
  pieces: readonly GridPiece[],
  setHash: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pieces) {
    if (p.setHash !== setHash || p.archetype === undefined) continue;
    out.set(p.archetype, (out.get(p.archetype) ?? 0) + 1);
  }
  return out;
}

/** Which slots (ARMOR_SLOTS order) the grid has at least one piece in, any tertiary. */
export function coveredSlots(grid: SetGrid): boolean[] {
  return grid.rows.map((row) => row.some((c) => c.count > 0));
}

/** One way to run two 2-piece bonuses: two slots from each set; the fifth is free. */
export interface TwoPlusTwo {
  /** Slot indices (ARMOR_SLOTS order) taken from the first / second set. */
  first: [number, number];
  second: [number, number];
  free: number;
}

/**
 * Every split of the five slots into two from the first set, two different ones from
 * the second, and one free, given which slots each set covers.
 */
export function twoPlusTwoSplits(first: boolean[], second: boolean[]): TwoPlusTwo[] {
  const out: TwoPlusTwo[] = [];
  const n = first.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (!first[a] || !first[b]) continue;
      for (let c = 0; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          if (c === a || c === b || d === a || d === b) continue;
          if (!second[c] || !second[d]) continue;
          const free = [0, 1, 2, 3, 4].find((s) => s !== a && s !== b && s !== c && s !== d)!;
          out.push({ first: [a, b], second: [c, d], free });
        }
      }
    }
  }
  return out;
}
