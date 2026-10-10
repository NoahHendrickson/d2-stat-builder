import { describe, expect, test } from "vitest";

import { collectDamagePerkNames, damagePerkIndexSet, isDamagePerk } from "./damage-perks";
import type { PerkRef } from "./types";

const perk = (name: string, description?: string, enhancedDescription?: string): PerkRef => ({
  hash: name.length,
  name,
  currentlyCanRoll: true,
  description,
  enhancedDescription,
});

describe("isDamagePerk", () => {
  test("classic damage buffs match (real Bungie descriptions)", () => {
    expect(
      isDamagePerk(
        perk("Frenzy", "Being in combat for an extended time increases damage, handling, and reload speed until you are out of combat."),
      ),
    ).toBe(true);
    expect(
      isDamagePerk(
        perk("Bait and Switch", "Deal damage with all equipped weapons within a short time to give this weapon a damage boost."),
      ),
    ).toBe(true);
    expect(
      isDamagePerk(
        perk("Aggregate Charge", "This weapon deals more damage for each elemental debuff applied to the target."),
      ),
    ).toBe(true);
    expect(
      isDamagePerk(
        perk("Precision Instrument", "Dealing sustained damage increases precision damage."),
      ),
    ).toBe(true);
    expect(
      isDamagePerk(
        perk("Vorpal Weapon", "Increased damage against bosses, vehicles, and Guardians with their Super active."),
      ),
    ).toBe(true);
    expect(
      isDamagePerk(perk("Target Lock", "Damage increases the longer this weapon remains on a target.")),
    ).toBe(true);
  });

  test("the enhanced description alone can classify a perk", () => {
    expect(
      isDamagePerk(
        perk(
          "Surrounded",
          "This weapon gains bonus damage when three or more enemies are in close proximity.",
          "This weapon gains improved bonus damage when three or more targets are in close proximity.",
        ),
      ),
    ).toBe(true);
    expect(isDamagePerk(perk("No Text"))).toBe(false);
  });

  test("trigger clauses and utility perks do not match", () => {
    expect(
      isDamagePerk(perk("Attrition Orbs", "Dealing sustained damage creates an Orb of Power.")),
    ).toBe(false);
    expect(
      isDamagePerk(
        perk("Outlaw", "Precision kills greatly decrease reload time."),
      ),
    ).toBe(false);
    expect(
      isDamagePerk(
        perk("Osmosis", "Using your grenade ability partially refills the magazine and changes this weapon's damage type to match your grenade until you stow it."),
      ),
    ).toBe(false);
  });

  test("defensive and incoming-damage text is vetoed", () => {
    expect(
      isDamagePerk(
        perk(
          "To the Pain",
          "While this weapon is equipped, taking damage increases handling and aim assist until the weapon is stowed. Taking more damage increases the effect.",
        ),
      ),
    ).toBe(false);
    expect(
      isDamagePerk(
        perk("Bipod", "Increases ammo and reserves but reduces damage, blast radius, and reload speed."),
      ),
    ).toBe(false);
  });

  test("ability-damage boosts are not weapon damage perks", () => {
    expect(
      isDamagePerk(
        perk("One-Two Punch", "Hitting an enemy with every pellet in a shot increases melee damage for a short duration."),
      ),
    ).toBe(false);
  });

  test("explosion-on-kill perks are not damage buffs", () => {
    expect(
      isDamagePerk(perk("Dragonfly", "Precision kills create an elemental damage explosion.")),
    ).toBe(false);
  });

  test("curated include overrides a heuristic miss", () => {
    // Gap between the verb and "damage" is too wide for the heuristic.
    expect(
      isDamagePerk(
        perk("Explosive Light", "Picking up an Orb of Power increases the next projectile's blast radius and damage."),
      ),
    ).toBe(true);
  });

  test("curated exclude overrides a heuristic match", () => {
    expect(
      isDamagePerk(
        perk(
          "Anticipation",
          "The charge speed of this weapon's next shot slowly increases over time. Anticipation builds more quickly as you deal more damage with other weapons.",
        ),
      ),
    ).toBe(false);
  });

  test("user-curated exclusions win even when the description is a damage buff", () => {
    expect(
      isDamagePerk(perk("Rampage", "Kills with this weapon temporarily grant increased damage. Stacks 3x.")),
    ).toBe(false);
    expect(isDamagePerk(perk("Kill Clip", "Reloading after a kill grants increased damage."))).toBe(
      false,
    );
  });
});

describe("damagePerkIndexSet / collectDamagePerkNames", () => {
  const catalog: PerkRef[] = [
    perk("Outlaw", "Precision kills greatly decrease reload time."),
    perk("Firing Line", "This weapon deals increased precision damage when near two or more allies."),
    perk("Surrounded", "This weapon gains bonus damage when three or more enemies are in close proximity."),
  ];

  test("collects indices of damage perks only", () => {
    expect([...damagePerkIndexSet(catalog)]).toEqual([1, 2]);
  });

  test("result is cached per catalog array", () => {
    expect(damagePerkIndexSet(catalog)).toBe(damagePerkIndexSet(catalog));
  });

  test("collects lowercased damage perk names", () => {
    expect([...collectDamagePerkNames(catalog)].sort()).toEqual(["firing line", "surrounded"]);
  });
});
