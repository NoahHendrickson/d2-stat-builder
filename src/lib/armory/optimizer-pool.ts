/**
 * Which armor pieces join the default optimizer pool, and how those pieces are
 * laid out per slot. Festival masks stay in festival-masks.ts; this module asks
 * them for optional helmet candidates rather than owning mask identity.
 *
 * Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
 */
import { helmetCandidates } from "./festival-masks";
import type { LegacyRaidKey } from "./legacy-raids";
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
   * flat +2 legacy masterwork; artifice ones keep their +3.
   */
  legacyArmor: boolean;
  /**
   * Legacy raids the builder requires pieces of (Set bonuses → Legacy raid sets). Their
   * Armor 2.0 legendaries join the pool whatever `legacyArmor` says: a requirement on
   * them is a request to use them.
   */
  legacyRaids: ReadonlySet<LegacyRaidKey>;
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
    legacyRaid?: LegacyRaidKey;
  },
  opts: PoolOptions,
): boolean {
  if (piece.isFestivalMask) return false;
  if (piece.tunedStat !== undefined) return true;
  if (piece.isExotic) return opts.legacyExotics;
  if (piece.archetype !== undefined) return opts.lowerTierArmor;
  return (
    opts.legacyArmor ||
    (piece.legacyRaid !== undefined && opts.legacyRaids.has(piece.legacyRaid))
  );
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

/**
 * The slots that stop the optimizer from making any build because they have no
 * legendary candidate. A build needs a piece in every slot and at most one exotic, so
 * two such slots always block it. One blocks it unless an allowed exotic can fill it:
 * there's an exotic in that slot, and `exoticSlot` (the picked exotic's slot, `null` for
 * any) is that slot. Returns `[]` when every slot can be filled.
 */
export function blockedLegendarySlots(
  slots: readonly (readonly { isExotic: boolean }[])[],
  exoticSlot: ArmorSlot | null,
): ArmorSlot[] {
  const missing = ARMOR_SLOTS.filter((_, i) => !slots[i]?.some((p) => !p.isExotic));
  if (missing.length !== 1) return missing;
  const slot = missing[0];
  const exoticFits =
    (exoticSlot === null || exoticSlot === slot) &&
    slots[ARMOR_SLOTS.indexOf(slot)].some((p) => p.isExotic);
  return exoticFits ? [] : missing;
}

/**
 * Which pool toggles, now off, would add a legendary to one of `slots` from the class's
 * armor (see blockedLegendarySlots): what the empty Builds list can offer to turn on.
 */
export function poolTogglesForSlots(
  classPieces: readonly (Parameters<typeof inDefaultOptimizerPool>[0] & {
    slot: ArmorSlot;
  })[],
  slots: readonly ArmorSlot[],
  opts: PoolOptions,
): { lowerTierArmor: boolean; legacyArmor: boolean } {
  const adds = (on: PoolOptions) =>
    classPieces.some(
      (p) =>
        !p.isExotic &&
        slots.includes(p.slot) &&
        !inDefaultOptimizerPool(p, opts) &&
        inDefaultOptimizerPool(p, on),
    );
  return {
    lowerTierArmor: !opts.lowerTierArmor && adds({ ...opts, lowerTierArmor: true }),
    legacyArmor: !opts.legacyArmor && adds({ ...opts, legacyArmor: true }),
  };
}
