// Where a run of applies has put gear. Bungie's profile can lag several seconds behind a
// move, and a loadout planned from an old profile asks to move a piece from where it
// used to be, which Bungie refuses. A run is the only thing moving gear while it goes, so
// what it did is more reliable than what the profile says.
// Pure — runtime imports stay relative so the module runs under vitest.
import type { Armory } from "../armory/fetch";
import type { ArmorLocation } from "../armory/normalize";
import type { ItemResult } from "../bungie/equip-server";

export interface GearSpot {
  location: ArmorLocation;
  characterId?: string;
}

/** Instance id → where the run left it. */
export type KnownSpots = ReadonlyMap<string, GearSpot>;

/** `known`, plus everything one apply onto `characterId` moved. */
export function spotsAfterApply(
  known: KnownSpots,
  armory: Armory,
  results: readonly Pick<ItemResult, "itemInstanceId" | "ok" | "vaulted">[],
  characterId: string,
): KnownSpots {
  const next = new Map(known);
  const gear = [...armory.pieces, ...(armory.weapons ?? [])];
  const subclassIds =
    armory.characters.find((c) => c.id === characterId)?.subclassItems.map((s) => s.instanceId) ?? [];
  const spotOf = (item: (typeof gear)[number]): GearSpot => next.get(item.instanceId) ?? item;

  for (const result of results) {
    for (const id of result.vaulted ?? []) next.set(id, { location: "vault" });
    if (!result.ok) continue;
    const id = result.itemInstanceId;
    if (subclassIds.includes(id)) {
      for (const other of subclassIds) next.delete(other);
      next.set(id, { location: "equipped", characterId });
      continue;
    }
    const item = gear.find((g) => g.instanceId === id);
    if (!item) continue;
    // Whatever it replaced comes off into the character's inventory.
    for (const other of gear) {
      const spot = spotOf(other);
      if (
        other.instanceId !== id &&
        other.slot === item.slot &&
        spot.location === "equipped" &&
        spot.characterId === characterId
      ) {
        next.set(other.instanceId, { location: "inventory", characterId });
      }
    }
    next.set(id, { location: "equipped", characterId });
  }
  return next;
}

/** `armory` with every piece the run has moved shown where the run left it. */
export function withKnownSpots(armory: Armory, known: KnownSpots): Armory {
  const placed = <T extends { instanceId: string; postmaster?: boolean }>(item: T): T => {
    const spot = known.get(item.instanceId);
    if (!spot) return item;
    return {
      ...item,
      location: spot.location,
      characterId: spot.characterId,
      ...(item.postmaster ? { postmaster: false } : {}),
    };
  };
  return {
    ...armory,
    pieces: armory.pieces.map(placed),
    weapons: armory.weapons?.map(placed),
    characters: armory.characters.map((character) => {
      const equipped = character.subclassItems.find(
        (s) => known.get(s.instanceId)?.location === "equipped",
      );
      if (!equipped) return character;
      return {
        ...character,
        subclassItems: character.subclassItems.map((s) => ({
          ...s,
          equipped: s.instanceId === equipped.instanceId,
        })),
      };
    }),
  };
}
