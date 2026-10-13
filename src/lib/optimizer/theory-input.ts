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
 * An Armor 3.0 piece's roll: its archetype (by name, or by its top two base stats when
 * the name is unknown) and tertiary, the third-highest base stat.
 */
function rollOf(
  p: ArmorPiece,
  archetypes: ArmorArchetype[],
): { archetype: ArmorArchetype; tertiary: number } | null {
  const [primary, secondary, tertiary] = rollStatIndices(p.baseStats);
  const archetype =
    archetypes.find((a) => a.name === p.archetype) ??
    archetypes.find((a) => a.primary === primary && a.secondary === secondary);
  return archetype ? { archetype, tertiary } : null;
}

/** A piece as an owned copy of its roll (none when its archetype is unknown). */
function ownedRollOf(
  p: ArmorPiece,
  archetypes: ArmorArchetype[],
): { instanceId: string; archetype: string; tertiary: number }[] {
  const roll = rollOf(p, archetypes);
  return roll ? [{ instanceId: p.instanceId, archetype: roll.archetype.name, tertiary: roll.tertiary }] : [];
}

/**
 * Owned Tier-5 legendaries as rolls a theoretical build can use in place of a farmed
 * one: only tuned pieces whose stats are exactly the generic roll's (30 / 25 / 20, 5s).
 */
export function theoryOwnedRolls(pieces: ArmorPiece[], archetypes: ArmorArchetype[]): OwnedRoll[] {
  return pieces.flatMap((p) => {
    if (p.isExotic || p.tunedStat === undefined) return [];
    const roll = rollOf(p, archetypes);
    if (!roll) return [];
    const { archetype, tertiary } = roll;
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
 * The right Spirits' tertiaries there are mostly guesses, so what an owned copy shows a
 * Spirit actually rolls wins, and every matching owned copy's roll is allowed.
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
    const copies = pieces.filter((p) => p.itemHash === classItemHash && p.tunedStat !== undefined);
    // Right Spirit → the tertiary owned copies show it gives.
    const observed = new Map<number, number>();
    for (const p of copies) {
      const spirit = p.exoticPerkHashes?.[1];
      if (spirit !== undefined) observed.set(spirit, rollStatIndices(p.baseStats)[2]);
    }
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
              resolveTertiary(
                observed.get(r.hash) ?? r.preferredTertiary,
                archetype.primary,
                archetype.secondary,
              ),
            );
      for (const tertiary of new Set(tertiaries)) rolls.push({ archetype: archetype.name, tertiary });
    }
    const picked = left !== null || right !== null;
    const owned = copies.flatMap((p) =>
      picked && !matchesSpiritSelection(p.exoticPerkHashes, choice.exoticPerks)
        ? []
        : ownedRollOf(p, archetypes),
    );
    for (const o of owned) {
      if (!rolls.some((r) => r.archetype === o.archetype && r.tertiary === o.tertiary)) {
        rolls.push({ archetype: o.archetype, tertiary: o.tertiary });
      }
    }
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
  const owned = copies.flatMap((p) => ownedRollOf(p, archetypes));
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
