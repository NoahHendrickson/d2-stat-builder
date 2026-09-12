import { buildFragmentStats } from "../armory/fragments";
import { STAT_HASH_TO_INDEX, type StatArray } from "../armory/stats";
import type { ModPlacement, SavedLoadoutData } from "./types";

type InvestmentStat = {
  statTypeHash: number;
  value: number;
  isConditionallyActive?: boolean;
};

/** Piece fields the drawer totals need — live armor plus whatever is currently placed. */
export interface EditorStatPiece {
  instanceId: string;
  stats: StatArray;
}

export interface EditorTotals {
  stats: StatArray;
  total: number;
}

/**
 * Armor + placed mods + fragments, clamped to 0–200 per stat (same window the
 * optimizer reports). `investmentStats` is the plug's manifest investment list.
 */
export function sumEditorStats(
  pieces: readonly EditorStatPiece[],
  placement: ModPlacement,
  fragmentHashes: readonly number[],
  classType: number,
  investmentStats: (hash: number) => InvestmentStat[] | undefined,
): EditorTotals {
  const stats: StatArray = [0, 0, 0, 0, 0, 0];
  for (const piece of pieces) {
    for (let i = 0; i < 6; i++) stats[i] += piece.stats[i];
    for (const hash of Object.values(placement[piece.instanceId] ?? {})) {
      for (const inv of investmentStats(hash) ?? []) {
        const i = STAT_HASH_TO_INDEX[inv.statTypeHash];
        if (i !== undefined) stats[i] += inv.value;
      }
    }
  }
  for (const hash of fragmentHashes) {
    const bonus = buildFragmentStats(investmentStats(hash), classType).stats;
    for (let i = 0; i < 6; i++) stats[i] += bonus[i];
  }
  const clamped = stats.map((v) => Math.max(0, Math.min(200, v))) as StatArray;
  return { stats: clamped, total: clamped.reduce((sum, v) => sum + v, 0) };
}

/**
 * The displayed totals of a saved loadout are what the editor last showed. The rest of
 * the optimizer breakdown (base, tuning, mod bonus…) stays as the build was generated.
 * No-op without `totals` (a piece was missing, so the editor had no complete sum).
 */
export function withEditorTotals(
  data: SavedLoadoutData,
  totals: EditorTotals | undefined,
): SavedLoadoutData {
  if (!totals || !data.optimizer) return data;
  return { ...data, optimizer: { ...data.optimizer, stats: totals.stats, total: totals.total } };
}
