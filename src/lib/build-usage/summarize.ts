// Which armor pieces one optimizer result used, for the /armor "Builds" history.
//
// A piece counts as USED when it (or a piece the search treated as interchangeable with
// it, see makeInterchangeKey) is in one of the builds the builder shows. It counts as
// OPTIMAL when at least one of those builds is not dominated: no other build in the
// result with the same exotic is at least as high on every stat and higher on one.
// Every piece the query could have used is reported too, so "never used" can be told
// apart from "never had the chance". Exotics only count in queries that picked that
// exotic: with "any", a build holds one of many, and what an exotic is worth is its
// perk, not its stats. Picked, the count says which copy of it the builds reach for.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import { makeExoticEligible, makeInterchangeKey } from "../optimizer/bounds";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  OptimizerPiece,
} from "../optimizer/types";

/** Builds the builder lists per query (MAX_SHOWN in build-results.tsx). */
export const USED_RESULT_COUNT = 50;

export interface PieceUsage {
  id: string;
  used: boolean;
  optimal: boolean;
}

/** Live armor instance ids only; synthetic pieces (theoretical exotic class items) are skipped. */
const INSTANCE_ID = /^\d{1,20}$/;
export const isInstanceId = (id: string) => INSTANCE_ID.test(id);

/**
 * Per build, whether another build in the list beats it on every stat (and on power,
 * while a power range is enforced). Only builds with the same exotic are compared: a
 * different exotic is a different build, whatever its stats.
 */
export function dominatedBuilds(
  loadouts: readonly OptimizerLoadout[],
  pieceById: ReadonlyMap<string, OptimizerPiece>,
  withPower: boolean,
): boolean[] {
  const exoticOf = (l: OptimizerLoadout) => {
    for (const id of l.pieceIds) {
      const p = pieceById.get(id);
      if (p?.exotic) return p.hash ?? -1;
    }
    return 0;
  };
  const exotics = loadouts.map(exoticOf);
  const vectors = loadouts.map((l) =>
    withPower ? [...l.stats, l.power ?? Number.NEGATIVE_INFINITY] : l.stats,
  );
  const beats = (a: number[], b: number[]) => {
    let higher = false;
    for (let s = 0; s < a.length; s++) {
      if (a[s] < b[s]) return false;
      if (a[s] > b[s]) higher = true;
    }
    return higher;
  };
  return loadouts.map((_, i) =>
    loadouts.some((_, j) => j !== i && exotics[j] === exotics[i] && beats(vectors[j], vectors[i])),
  );
}

/** Every piece the query could have used, flagged with whether the shown builds used it. */
export function summarizeRun(input: OptimizerInput, output: OptimizerOutput): PieceUsage[] {
  const pieceById = new Map<string, OptimizerPiece>();
  for (const slot of input.slots) for (const p of slot) pieceById.set(p.id, p);
  const dominated = dominatedBuilds(output.loadouts, pieceById, input.powerRange !== undefined);
  const keyOf = makeInterchangeKey(input);
  const exoticEligible = makeExoticEligible(input);
  const picked = input.exotic?.mode === "specific";
  const eligible = (p: OptimizerPiece) => exoticEligible(p) && (!p.exotic || picked);

  // Per slot: interchange key → whether a shown build used it / used it in an optimal build.
  const usedKeys = input.slots.map(() => new Map<string, boolean>());
  output.loadouts.slice(0, USED_RESULT_COUNT).forEach((l, i) => {
    l.pieceIds.forEach((id, slot) => {
      const p = pieceById.get(id);
      if (!p || !usedKeys[slot]) return;
      const key = keyOf(p);
      usedKeys[slot].set(key, (usedKeys[slot].get(key) ?? false) || !dominated[i]);
    });
  });

  const out = new Map<string, PieceUsage>();
  input.slots.forEach((slot, s) => {
    for (const p of slot) {
      if (!isInstanceId(p.id) || out.has(p.id) || !eligible(p)) continue;
      const optimal = usedKeys[s].get(keyOf(p));
      out.set(p.id, { id: p.id, used: optimal !== undefined, optimal: optimal === true });
    }
  });
  return [...out.values()];
}

/**
 * What makes two runs "the same query" for the history: everything the optimizer was
 * asked except the piece pool, plus the class. Re-running it later (even with a changed
 * vault) replaces that query's record instead of counting again.
 */
export function queryIdentity(input: OptimizerInput, classType: number): string {
  return JSON.stringify([
    classType,
    input.minimums,
    input.mods ?? null,
    [...(input.setRequirements ?? [])]
      .sort((a, b) => a.setHash - b.setHash || a.count - b.count)
      .map((r) => [r.setHash, r.count]),
    input.exotic?.mode ?? "any",
    [...(input.exotic?.hashes ?? [])].sort((a, b) => a - b),
    input.allowTuning ?? true,
    input.allowBalancedTuning ?? true,
    input.fragmentBonus ?? null,
    input.powerRange ?? null,
  ]);
}
