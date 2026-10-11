// Which armor pieces one optimizer result used, for the /armor "Searches" history.
//
// A piece counts as USED when it (or a piece the search treated as interchangeable with
// it, see makeInterchangeKey) is in one of the builds the builder displays. Every piece
// the query could have used is reported too, so "never used" can be told apart from
// "never had the chance". Exotics only count in queries that picked that exotic: with
// "any", a build holds one of many, and what an exotic is worth is its perk, not its
// stats. Picked, the count says which copy of it the builds reach for.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import { makeExoticEligible, makeInterchangeKey } from "../optimizer/bounds";
import type { OptimizerInput, OptimizerLoadout, OptimizerPiece } from "../optimizer/types";

export interface PieceUsage {
  id: string;
  used: boolean;
}

/** Live armor instance ids only; synthetic pieces (theoretical exotic class items) are skipped. */
const INSTANCE_ID = /^\d{1,20}$/;
export const isInstanceId = (id: string) => INSTANCE_ID.test(id);

/**
 * Every piece the query could have used, flagged with whether one of `displayed` (the
 * builds on screen, in the order and number the builder shows them) used it.
 */
export function summarizeRun(
  input: OptimizerInput,
  displayed: readonly OptimizerLoadout[],
): PieceUsage[] {
  const pieceById = new Map<string, OptimizerPiece>();
  for (const slot of input.slots) for (const p of slot) pieceById.set(p.id, p);
  const keyOf = makeInterchangeKey(input);
  const exoticEligible = makeExoticEligible(input);
  const mode = input.exotic?.mode ?? "any";
  const picked = mode === "specific";
  // A forced exotic that only exists in one slot takes that slot in every build, so the
  // slot's legendaries never had a chance and aren't counted.
  const exoticSlots = new Set<number>();
  input.slots.forEach((slot, s) => {
    if (slot.some((p) => p.exotic && exoticEligible(p))) exoticSlots.add(s);
  });
  const takenSlot =
    (mode === "specific" || mode === "require") && exoticSlots.size === 1
      ? [...exoticSlots][0]
      : -1;
  const eligible = (p: OptimizerPiece, s: number) =>
    exoticEligible(p) && (p.exotic ? picked : s !== takenSlot);

  // Per slot: the interchange keys a displayed build used.
  const usedKeys = input.slots.map(() => new Set<string>());
  for (const l of displayed) {
    l.pieceIds.forEach((id, slot) => {
      const p = pieceById.get(id);
      if (p && usedKeys[slot]) usedKeys[slot].add(keyOf(p));
    });
  }

  const out = new Map<string, PieceUsage>();
  input.slots.forEach((slot, s) => {
    for (const p of slot) {
      if (!isInstanceId(p.id) || out.has(p.id) || !eligible(p, s)) continue;
      out.set(p.id, { id: p.id, used: usedKeys[s].has(keyOf(p)) });
    }
  });
  return [...out.values()];
}

/** The optimizer input minus what doesn't make it a different query. */
type QueryFields = Omit<OptimizerInput, "slots" | "maxResults">;

/**
 * What makes two runs "the same query" for the history: everything the optimizer was
 * asked except the piece pool (and the result cap), plus the class. Re-running it later
 * (even with a changed vault) replaces that query's record instead of counting again.
 * Every field is listed and normalized by type: a new OptimizerInput field fails to
 * compile here until it's added, so two different queries can't silently share a key.
 */
export function queryIdentity(input: OptimizerInput, classType: number): string {
  const fields: { [K in keyof Required<QueryFields>]: unknown } = {
    minimums: input.minimums,
    mods: input.mods ? [input.mods.major, input.mods.minor] : null,
    setRequirements: [...(input.setRequirements ?? [])]
      .sort((a, b) => a.setHash - b.setHash || a.count - b.count)
      .map((r) => [r.setHash, r.count]),
    exotic: [input.exotic?.mode ?? "any", [...(input.exotic?.hashes ?? [])].sort((a, b) => a - b)],
    allowTuning: input.allowTuning ?? true,
    allowBalancedTuning: input.allowBalancedTuning ?? true,
    fragmentBonus: input.fragmentBonus ?? null,
    powerRange: input.powerRange
      ? [
          input.powerRange.min,
          input.powerRange.max,
          [...(input.powerRange.weapons ?? [])].sort((a, b) => a - b),
        ]
      : null,
  };
  const keys = Object.keys(fields).sort() as (keyof QueryFields)[];
  return JSON.stringify([classType, ...keys.map((k) => [k, fields[k]])]);
}
