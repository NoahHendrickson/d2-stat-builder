import type { PerkRef, WeaponSummary } from "./types";

/**
 * Where a weapon's perks can be picked on the weapon page: one slot per perk
 * column, plus one for the masterworks and one for the mods. The grid draws the
 * `perk` slots; the Masterworks and Mods sections draw the others. A slot's
 * `key` is what picks are stored under: a perk slot's is its column index (the
 * same index popularity counts by), and the masterwork and mod slots come after
 * every column, so no key is shared or negative.
 */
export interface PickSlot {
  key: number;
  kind: "perk" | "masterwork" | "mod";
  /** The column's kind ("Barrel", "Trait", …), or "Masterworks" / "Mods". */
  label: string;
  /** Catalog perk indices, in the order the slot shows them. */
  perkIndices: readonly number[];
  /** The `perkIndices` only crafting gives on this weapon. */
  craftedOnly?: readonly number[];
}

/** One pick per slot: slot key → catalog perk index. */
export type Roll = Record<number, number>;

/** The intrinsic column, when it has only the one frame (so nothing to pick). */
function fixedFrameColumn(weapon: WeaponSummary) {
  return weapon.columns.find((c) => c.kind === "Intrinsic" && c.perkIndices.length === 1);
}

/** The pick slots of one weapon, in page order (see `PickSlot`). */
export function pickSlots(weapon: WeaponSummary): PickSlot[] {
  const fixed = fixedFrameColumn(weapon);
  const slots: PickSlot[] = weapon.columns.flatMap((column, i) =>
    column === fixed
      ? []
      : [
          {
            key: i,
            kind: "perk" as const,
            label: column.kind,
            perkIndices: column.perkIndices,
            craftedOnly: column.craftedOnly,
          },
        ],
  );
  const after = weapon.columns.length;
  if (weapon.masterworks?.length)
    slots.push({ key: after, kind: "masterwork", label: "Masterworks", perkIndices: weapon.masterworks });
  if (weapon.mods?.length)
    slots.push({ key: after + 1, kind: "mod", label: "Mods", perkIndices: weapon.mods });
  return slots;
}

/** A weapon's frame (its intrinsic perk), as the header and the Stats card show it. */
export interface ResolvedFrame {
  perk: PerkRef | undefined;
  /** The weapon has only this frame, so the grid doesn't show it. */
  fixed: boolean;
}

/**
 * The frame to show: the one picked in the grid if the weapon has a choice,
 * else its only frame, else the one the weapon is named for, else its first.
 * A weapon with no intrinsic column has none.
 */
export function resolveFrame(
  weapon: WeaponSummary,
  perks: readonly PerkRef[],
  picked: Roll = {},
): ResolvedFrame {
  const column = weapon.columns.findIndex((c) => c.kind === "Intrinsic");
  if (column < 0) return { perk: undefined, fixed: false };
  const indices = weapon.columns[column]!.perkIndices;
  const pick = picked[column];
  const perk =
    (pick !== undefined ? perks[pick] : undefined) ??
    indices.map((i) => perks[i]).find((p) => p?.name === weapon.frame) ??
    perks[indices[0]!];
  return { perk, fixed: indices.length === 1 };
}
