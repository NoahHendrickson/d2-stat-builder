/** The theoretical search's public types (see index.ts). */
import type { ArmorArchetype } from "../../armory/archetypes";
import type { ModBudget, SetRequirement, StatArray } from "../types";

/** One farmable roll: an archetype and its tertiary stat. */
export interface TheoryRoll {
  archetype: string;
  primary: number;
  secondary: number;
  tertiary: number;
}

/** An owned Tier-5 legendary, reduced to what makes it interchangeable with a farmed roll. */
export interface OwnedRoll {
  instanceId: string;
  /** Index into ARMOR_SLOTS. */
  slot: number;
  archetype: string;
  tertiary: number;
  /** The rolled tuned stat (where its directional tuning puts the +5). */
  tuned: number;
  setHash?: number;
}

/** The exotic a theoretical build wears, in its own slot. */
export interface TheoryExotic {
  /** Index into ARMOR_SLOTS. */
  slot: number;
  /** The rolls it can drop with; null = any archetype and tertiary. */
  rolls: { archetype: string; tertiary: number }[] | null;
  /** The def-level stat bonus a Tier-5 copy adds (zeros when there's none). */
  intrinsic: StatArray;
  /** Owned Tier-5 copies. Their tuning is flexible, so the tuned stat doesn't matter. */
  owned: { instanceId: string; archetype: string; tertiary: number }[];
}

export interface TheoryInput {
  archetypes: ArmorArchetype[];
  owned: OwnedRoll[];
  minimums: StatArray;
  mods: ModBudget;
  fragmentBonus: StatArray;
  exotic: TheoryExotic | null;
  sets: SetRequirement[];
}

/** A directional tuning: +5 to `plus` (the piece's tuned stat), −5 to `minus`. */
export interface TheoryTuning {
  plus: number;
  minus: number;
}

export interface TheoryPiece extends TheoryRoll {
  /** The slot it goes in (ARMOR_SLOTS index): an owned piece's own, the exotic's, or one left open. */
  slot: number;
  /** null = any tuned stat will do (the piece needs no tuning). */
  tuning: TheoryTuning | null;
  /** The owned piece that already has this roll, and its slot (ARMOR_SLOTS index). */
  owned?: { instanceId: string; slot: number };
  /** The build's exotic (its tuning is flexible: any +5). */
  exotic?: true;
  /** The required set this piece counts toward. */
  setHash?: number;
}

/**
 * What a build spends its spare points on: one stat (index), or fewest tuned pieces. A
 * close build misses the targets instead.
 */
export type TheoryFocus = number | "flexible" | "close";

export interface TheoryRecipe {
  /** Stable identity: the rolls, their tunings and sets, and the final stats. */
  key: string;
  focus: TheoryFocus;
  /** One per slot, in slot order (helmet, arms, chest, legs, class item). */
  pieces: TheoryPiece[];
  /** Final stats after mods, tuning, fragments and the exotic's bonus, clamped to 0–200. */
  stats: StatArray;
  total: number;
  /** Stat mods per stat: [majors, minors]. */
  mods: [number, number][];
  /** Pieces already owned. */
  owned: number;
  /** Legendaries that need a particular tuned stat (the exotic's tuning is flexible). */
  tuned: number;
  /** Slots no owned piece fills (ARMOR_SLOTS indices) — the farmed pieces go here. */
  openSlots: number[];
  /** Close builds only: points short of each stat's target (0 where it's met). */
  short?: StatArray;
}

export interface TheoryResult {
  recipes: TheoryRecipe[];
  /**
   * Max reachable value per stat with the OTHER stats at their targets (each stat's own
   * target ignored), exact. All zero when the other targets can't be met at all.
   */
  ceilings: StatArray;
  /** The set bonuses need more pieces than the build has to give them. */
  setsDontFit: boolean;
  /**
   * When there are few builds: ones that miss the targets by a few points, fewest missed
   * first. Empty otherwise.
   */
  close: TheoryRecipe[];
}
