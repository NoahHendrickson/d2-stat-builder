import type { ArmorPiece } from "@/lib/armory/normalize";

export type DuplicateRow = {
  piece: Pick<
    ArmorPiece,
    | "classType"
    | "slot"
    | "itemHash"
    | "isExotic"
    | "setHash"
    | "archetype"
    | "baseStats"
    | "tunedStat"
    | "exoticPerkHashes"
  >;
  tertiary?: number;
};

/** Which of the optional fields twins must share (the rest always has to match). */
export interface DuplicateMatch {
  tuning: boolean;
  tertiary: boolean;
}

export const DEFAULT_DUPLICATE_MATCH: DuplicateMatch = { tuning: true, tertiary: true };

/** "set, slot, archetype, tertiary, and tuning", minus what `match` leaves out. */
export function duplicateMatchSummary(match: DuplicateMatch): string {
  const fields = ["set", "slot", "archetype"];
  if (match.tertiary) fields.push("tertiary");
  if (match.tuning) fields.push("tuning");
  return `${fields.slice(0, -1).join(", ")}, and ${fields.at(-1)}`;
}

export interface DuplicateGroups<R> {
  /** Only pieces with at least one twin, each group contiguous. */
  rows: R[];
  /** Per entry of `rows`: its group's index, and whether it opens the group. */
  groups: { index: number; first: boolean }[];
  groupCount: number;
}

/**
 * What makes two Armor 3.0 pieces interchangeable: same class, slot, and set (or the
 * same exotic, with the same perks on class items), and the same archetype, plus the
 * tertiary and tuned stat unless `match` leaves them out. An unresolved archetype falls
 * back to the roll's two highest stats. Legacy pieces (no tertiary) have no archetype
 * shape to compare, so they never match.
 */
export function duplicateKey(
  row: DuplicateRow,
  match: DuplicateMatch = DEFAULT_DUPLICATE_MATCH,
): string | undefined {
  const { piece } = row;
  if (row.tertiary === undefined) return undefined;
  const archetype =
    piece.archetype ??
    piece.baseStats
      .map((_, i) => i)
      .sort((a, b) => piece.baseStats[b] - piece.baseStats[a])
      .slice(0, 2)
      .join(">");
  const source = piece.isExotic
    ? `x${piece.itemHash}:${piece.exoticPerkHashes?.join(",") ?? ""}`
    : `s${piece.setHash ?? `i${piece.itemHash}`}`;
  return [
    piece.classType,
    piece.slot,
    source,
    archetype,
    match.tertiary ? row.tertiary : "*",
    match.tuning ? (piece.tunedStat ?? "-") : "*",
  ].join("|");
}

/**
 * Keeps the rows that share a `duplicateKey` with another row, grouped together.
 * Groups come in the order of their first member, and members keep their input
 * order, so the table's sort still ranks pieces within a group.
 */
export function groupDuplicates<R extends DuplicateRow>(
  rows: readonly R[],
  match: DuplicateMatch = DEFAULT_DUPLICATE_MATCH,
): DuplicateGroups<R> {
  const byKey = new Map<string, R[]>();
  for (const row of rows) {
    const key = duplicateKey(row, match);
    if (key === undefined) continue;
    const members = byKey.get(key);
    if (members) members.push(row);
    else byKey.set(key, [row]);
  }
  const out: DuplicateGroups<R> = { rows: [], groups: [], groupCount: 0 };
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const index = out.groupCount++;
    members.forEach((row, i) => {
      out.rows.push(row);
      out.groups.push({ index, first: i === 0 });
    });
  }
  return out;
}
