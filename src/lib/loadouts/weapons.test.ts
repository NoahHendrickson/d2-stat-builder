import { describe, expect, test } from "vitest";
import type { LoadoutWeapon } from "../armory/weapons";
import type { DimLoadout } from "../dim/loadout-link";
import { planExoticWeaponSwap, withLoadoutWeapons } from "./weapons";

const weapon = (instanceId: string, over: Partial<LoadoutWeapon> = {}): LoadoutWeapon => ({
  instanceId,
  itemHash: 1,
  name: instanceId,
  typeName: "Hand Cannon",
  slot: "kinetic",
  isExotic: false,
  location: "vault",
  ...over,
});

describe("withLoadoutWeapons", () => {
  const loadout = {
    equipped: [
      { id: "helm", hash: 10 },
      { id: "old-gun", hash: 20 },
      { id: "12345", hash: 30 },
    ],
  } as DimLoadout;
  const isWeapon = (ref: { hash: number }) => ref.hash === 20 || ref.hash === 21;

  test("swaps the weapon refs and leaves armor and the subclass alone", () => {
    const next = withLoadoutWeapons(loadout, [{ id: "new-gun", hash: 21 }], isWeapon);
    expect(next.equipped).toEqual([
      { id: "helm", hash: 10 },
      { id: "12345", hash: 30 },
      { id: "new-gun", hash: 21 },
    ]);
  });

  test("no weapons makes the loadout armor-only", () => {
    expect(withLoadoutWeapons(loadout, [], isWeapon).equipped).toEqual([
      { id: "helm", hash: 10 },
      { id: "12345", hash: 30 },
    ]);
  });
});

describe("planExoticWeaponSwap", () => {
  const me = "char-1";
  const equippedExotic = weapon("worn-exotic", {
    slot: "kinetic",
    isExotic: true,
    location: "equipped",
    characterId: me,
  });
  const incoming = weapon("new-exotic", { slot: "power", isExotic: true });

  test("nothing to do without an exotic in the loadout", () => {
    expect(planExoticWeaponSwap([weapon("legendary")], [equippedExotic], me)).toEqual({});
  });

  test("nothing to do when the loadout fills the equipped exotic's slot itself", () => {
    const kinetic = weapon("kinetic-legendary", { slot: "kinetic" });
    expect(planExoticWeaponSwap([incoming, kinetic], [equippedExotic, kinetic], me)).toEqual({});
  });

  test("re-equipping the exotic that is already on is not a conflict", () => {
    expect(planExoticWeaponSwap([equippedExotic], [equippedExotic], me)).toEqual({});
  });

  test("prefers a legendary already on the character, then the strongest", () => {
    const owned = [
      equippedExotic,
      weapon("vault-strong", { power: 500 }),
      weapon("here-weak", { location: "inventory", characterId: me, power: 100 }),
      weapon("here-strong", { location: "inventory", characterId: me, power: 300 }),
      weapon("other-exotic", { isExotic: true, location: "inventory", characterId: me }),
      weapon("wrong-slot", { slot: "energy", location: "inventory", characterId: me }),
    ];
    expect(planExoticWeaponSwap([incoming], owned, me).swap?.instanceId).toBe("here-strong");
  });

  test("falls back to the vault, never to the postmaster or another character's equipped gear", () => {
    const owned = [
      equippedExotic,
      weapon("lost", { location: "inventory", characterId: me, postmaster: true }),
      weapon("worn-elsewhere", { location: "equipped", characterId: "char-2" }),
      weapon("vaulted", { power: 200 }),
    ];
    expect(planExoticWeaponSwap([incoming], owned, me).swap?.instanceId).toBe("vaulted");
  });

  test("says so when nothing can take the slot", () => {
    expect(planExoticWeaponSwap([incoming], [equippedExotic], me)).toEqual({
      blocked: "worn-exotic is equipped and nothing else can take its slot",
    });
  });
});
