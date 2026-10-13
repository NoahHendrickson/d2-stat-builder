/**
 * The theoretical search's inventory-side inputs (see theory/): the owned pieces it can
 * seat, and the exotic the builder has picked.
 */
import type { ArmorArchetype } from "../armory/archetypes";
import {
  matchesSpiritSelection,
  resolveTertiary,
  type SpiritPerkInfo,
} from "../armory/exotic-class-perks";
import { intrinsicStats, type ArmorPiece } from "../armory/normalize";
import { ARMOR_SLOTS, rollStatIndices, type ArmorSlot } from "../armory/stats";
import { t5RollStats, tertiariesOf } from "../armory/t5-rolls";
import type { Manifest } from "../manifest/load";
import type { OwnedRoll, TheoryExotic } from "./theory";

/**
 * Owned Tier-5 legendaries as rolls a theoretical build can use in place of a farmed
 * one: only pieces whose stats are exactly the generic roll's (30 / 25 / 20, 5s).
 */
export function theoryOwnedRolls(pieces: ArmorPiece[], archetypes: ArmorArchetype[]): OwnedRoll[] {
  const byName = new Map(archetypes.map((a) => [a.name, a]));
  return pieces.flatMap((p) => {
    const archetype = p.archetype ? byName.get(p.archetype) : undefined;
    if (p.isExotic || p.tunedStat === undefined || !archetype) return [];
    const tertiary = rollStatIndices(p.baseStats)[2];
    const expected = t5RollStats(archetype.primary, archetype.secondary, tertiary);
    if (expected.some((v, s) => v !== p.stats[s])) return [];
    return [
      {
        instanceId: p.instanceId,
        slot: ARMOR_SLOTS.indexOf(p.slot),
        archetype: archetype.name,
        tertiary,
        tuned: p.tunedStat,
        setHash: p.setHash,
      },
    ];
  });
}

/** An Armor 3.0 roll read off a piece's base stats: the top three are 30 / 25 / 20. */
function rollOf(
  p: ArmorPiece,
  archetypes: ArmorArchetype[],
): { archetype: string; tertiary: number } | null {
  const [primary, secondary, tertiary] = rollStatIndices(p.baseStats);
  const archetype =
    archetypes.find((a) => a.name === p.archetype) ??
    archetypes.find((a) => a.primary === primary && a.secondary === secondary);
  if (!archetype) return null;
  return { archetype: archetype.name, tertiary };
}

export interface TheoryExoticChoice {
  /** The exotic the builder has picked (null = any, which theory reads as none). */
  option: { name: string; slot: ArmorSlot } | null;
  /** The picked item when it's an exotic class item. */
  classItemHash?: number;
  /** Its Spirits, and the pair picked (null in a column = any). */
  spiritPerks: { left: SpiritPerkInfo[]; right: SpiritPerkInfo[] } | null;
  exoticPerks: [number | null, number | null];
  pieces: ArmorPiece[];
  archetypes: ArmorArchetype[];
  manifest: Manifest;
}

/**
 * The exotic as theory sees it, plus whether its stat bonus is known: it is read from an
 * owned Tier-5 copy's definition, so an exotic owned only as a legacy piece gets none.
 *
 * An exotic class item's roll follows its Spirits: the left one sets the archetype, the
 * right one the tertiary (see exotic-class-perks.ts); an "any" column allows them all.
 */
export function theoryExotic(choice: TheoryExoticChoice): {
  exotic: TheoryExotic | null;
  bonusKnown: boolean;
} {
  const { option, classItemHash, pieces, archetypes, manifest } = choice;
  if (!option) return { exotic: null, bonusKnown: true };
  const slot = ARMOR_SLOTS.indexOf(option.slot);

  if (classItemHash !== undefined) {
    const [left, right] = choice.exoticPerks;
    const lefts = (choice.spiritPerks?.left ?? []).filter((s) => left === null || s.hash === left);
    const rights = (choice.spiritPerks?.right ?? []).filter((s) => right === null || s.hash === right);
    const rolls: { archetype: string; tertiary: number }[] = [];
    for (const l of lefts) {
      const archetype = archetypes.find(
        (a) => a.primary === l.primaryStat && a.secondary === l.secondaryStat,
      );
      if (!archetype) continue;
      const tertiaries =
        right === null
          ? tertiariesOf(archetype)
          : rights.map((r) =>
              resolveTertiary(r.preferredTertiary, archetype.primary, archetype.secondary),
            );
      for (const tertiary of new Set(tertiaries)) rolls.push({ archetype: archetype.name, tertiary });
    }
    const owned = pieces.flatMap((p) => {
      if (p.itemHash !== classItemHash || p.tunedStat === undefined) return [];
      const picked = left !== null || right !== null;
      if (picked && !matchesSpiritSelection(p.exoticPerkHashes, choice.exoticPerks)) return [];
      const roll = rollOf(p, archetypes);
      return roll ? [{ instanceId: p.instanceId, ...roll }] : [];
    });
    return {
      // Spirits that can't be read (no catalog entry, an unknown archetype) leave no rolls:
      // then any roll goes, rather than none.
      exotic: { slot, rolls: rolls.length ? rolls : null, intrinsic: [0, 0, 0, 0, 0, 0], owned },
      bonusKnown: true,
    };
  }

  const copies = pieces.filter(
    (p) => p.isExotic && p.name === option.name && p.tunedStat !== undefined,
  );
  const owned = copies.flatMap((p) => {
    const roll = rollOf(p, archetypes);
    return roll ? [{ instanceId: p.instanceId, ...roll }] : [];
  });
  const def = copies[0] && manifest.def("DestinyInventoryItemDefinition", copies[0].itemHash);
  return {
    exotic: {
      slot,
      rolls: null,
      intrinsic: def ? intrinsicStats(def) : [0, 0, 0, 0, 0, 0],
      owned,
    },
    bonusKnown: Boolean(def),
  };
}
