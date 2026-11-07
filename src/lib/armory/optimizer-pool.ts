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

/** What the pool rules read from an armor piece. */
export interface PoolPiece {
  isFestivalMask: boolean;
  tunedStat?: number;
  archetype?: string;
  isExotic: boolean;
  legacyRaid?: LegacyRaidKey;
}

/**
 * Default optimizer pool: T5 pieces (exactly those with a tuning socket) plus whatever
 * `opts` lets in, excluding FotL masks. Masks enter the helmet slot only as optional
 * candidates while a power range is enforced (see helmetCandidates).
 */
export function inDefaultOptimizerPool(piece: PoolPiece, opts: PoolOptions): boolean {
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
 * legendary candidate. `slots` is per ARMOR_SLOTS slot. A build needs a piece in every
 * slot and at most one exotic.
 * - A picked exotic (`exoticSlot`) fills its own slot, so every other slot needs a
 *   legendary.
 * - With any exotic allowed (`null`), one slot can go without a legendary when it has an
 *   exotic to use; a second can't.
 * Returns `[]` when every slot can be filled.
 */
export function blockedLegendarySlots(
  slots: readonly (readonly { isExotic: boolean }[])[],
  exoticSlot: ArmorSlot | null,
): ArmorSlot[] {
  const missing = ARMOR_SLOTS.filter(
    (slot, i) => slot !== exoticSlot && !slots[i].some((p) => !p.isExotic),
  );
  if (exoticSlot !== null || missing.length !== 1) return missing;
  const exoticFits = slots[ARMOR_SLOTS.indexOf(missing[0])].some((p) => p.isExotic);
  return exoticFits ? [] : missing;
}

/** The Advanced settings that let non-Tier-5 legendaries into the pool. */
export type PoolSetting = "lowerTierArmor" | "legacyArmor";
const POOL_SETTINGS: readonly PoolSetting[] = ["lowerTierArmor", "legacyArmor"];

/** Why no build can exist, and which settings fix it (see fillablePoolGap). */
export interface PoolGapFix {
  /** The slots with no legendary the pool may use. */
  slots: ArmorSlot[];
  /** The settings to turn on: either one is enough, unless `together`. */
  settings: PoolSetting[];
  /** Both settings are needed at once (neither alone unblocks a build). */
  together: boolean;
  /** The settings already on, so the notice can say what the pool uses now. */
  using: PoolSetting[];
}

/**
 * When missing legendaries rule out every build and turning on Lower tier and/or
 * Legacy armor would bring builds back: the blocked slots and the settings that do it.
 * Each candidate setting is checked by re-running blockedLegendarySlots with the pieces
 * it would add, so a setting that fills one gap but leaves another is never offered.
 * `null` when nothing is blocked, or when those settings can't unblock it.
 */
export function fillablePoolGap(
  slots: readonly (readonly PoolPiece[])[],
  classPieces: readonly (PoolPiece & { slot: ArmorSlot })[],
  exoticSlot: ArmorSlot | null,
  opts: PoolOptions,
): PoolGapFix | null {
  const blocked = blockedLegendarySlots(slots, exoticSlot);
  if (!blocked.length) return null;
  const off = POOL_SETTINGS.filter((setting) => !opts[setting]);
  const unblocks = (turnOn: readonly PoolSetting[]) => {
    const on = { ...opts, ...Object.fromEntries(turnOn.map((k) => [k, true])) };
    const widened = ARMOR_SLOTS.map((slot, i) => [
      ...slots[i],
      ...classPieces.filter(
        (p) => p.slot === slot && !inDefaultOptimizerPool(p, opts) && inDefaultOptimizerPool(p, on),
      ),
    ]);
    return blockedLegendarySlots(widened, exoticSlot).length === 0;
  };
  const alone = off.filter((setting) => unblocks([setting]));
  const using = POOL_SETTINGS.filter((setting) => opts[setting]);
  if (alone.length) return { slots: blocked, settings: alone, together: false, using };
  if (off.length > 1 && unblocks(off)) {
    return { slots: blocked, settings: off, together: true, using };
  }
  return null;
}
