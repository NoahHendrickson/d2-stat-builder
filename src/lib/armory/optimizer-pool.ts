/**
 * Which armor pieces join the default optimizer pool, and how those pieces are
 * laid out per slot. Festival masks stay in festival-masks.ts; this module asks
 * them for optional helmet candidates rather than owning mask identity.
 *
 * Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
 */
import { helmetCandidates } from "./festival-masks";
import { ARMOR_SLOTS, type ArmorSlot } from "./stats";

/** Which non-Tier-5 pieces join the optimizer pool alongside the T5 ones. */
export interface PoolOptions {
  /** Legacy (Armor 2.0 / non-tunable) exotics — the solver spends their artifice +3. */
  legacyExotics: boolean;
  /**
   * Tier 1–4 Armor 3.0 legendaries: an archetype but no tuning socket. Stats assume
   * a full masterwork like any other piece; they just can't be tuned.
   */
  lowerTierArmor: boolean;
  /**
   * Legacy (Armor 2.0) legendaries: no archetype, no tuning socket. Stats assume the
   * flat +2 legacy masterwork; artifice ones keep their +3. A "Power matters" option
   * (see includesLegacyArmor) — off while the toggle is, like the FotL masks.
   */
  legacyArmor: boolean;
}

/**
 * Default optimizer pool: T5 pieces (exactly those with a tuning socket) plus whatever
 * `opts` lets in, excluding FotL masks. Masks enter the helmet slot only as optional
 * candidates while a power range is enforced (see helmetCandidates).
 */
export function inDefaultOptimizerPool(
  piece: {
    isFestivalMask: boolean;
    tunedStat?: number;
    archetype?: string;
    isExotic: boolean;
  },
  opts: PoolOptions,
): boolean {
  if (piece.isFestivalMask) return false;
  if (piece.tunedStat !== undefined) return true;
  if (piece.isExotic) return opts.legacyExotics;
  return piece.archetype !== undefined ? opts.lowerTierArmor : opts.legacyArmor;
}

/**
 * Per-slot candidates in ARMOR_SLOTS order: `classItemPieces` as given (Spirit-filtered
 * or Dreamer's-pinned), helmets via helmetCandidates, everything else from `pool`.
 */
export function buildOptimizerSlots<T extends { slot: ArmorSlot }>(
  pool: readonly T[],
  opts: {
    classItemPieces: readonly T[];
    masks: readonly T[];
    powerConstrained: boolean;
  },
): T[][] {
  return ARMOR_SLOTS.map((slot) => {
    if (slot === "classItem") return [...opts.classItemPieces];
    if (slot === "helmet") {
      return [
        ...helmetCandidates(
          pool.filter((p) => p.slot === "helmet"),
          opts.masks,
          opts.powerConstrained,
        ),
      ];
    }
    return pool.filter((p) => p.slot === slot);
  });
}
