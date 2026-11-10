// What a character has equipped right now, as a loadout: the subclass with its
// abilities / aspects / fragments, the weapons, the armor with the mods socketed on it,
// and the artifact with its perks. Built as an in-game slot so it goes through the same
// conversion as importing one.
//
// Runtime imports are relative so the module runs under vitest.
import type { ArmoryCharacter } from "../armory/fetch";
import type { ArmorPiece } from "../armory/normalize";
import { CLASS_NAMES } from "../armory/stats";
import type { LoadoutWeapon } from "../armory/weapons";
import type { InGameLoadoutItem, InGameLoadoutSlot } from "../bungie/ingame-loadouts";
import { inGameSlotToLoadout, type SlotGearLookups } from "./ingame-import";
import type { SavedLoadoutData } from "./types";

/**
 * The character's equipped gear as a slot, every item with its live plugs. Armor names
 * each socket, so an empty tuning or artifice socket is saved as empty (Apply then
 * clears it) rather than left out.
 */
export function equippedGearSlot(
  character: Pick<ArmoryCharacter, "id" | "subclassItems" | "artifacts">,
  pieces: readonly ArmorPiece[],
  weapons: readonly LoadoutWeapon[],
): InGameLoadoutSlot {
  const onCharacter = (g: { location: string; characterId?: string }) =>
    g.location === "equipped" && g.characterId === character.id;
  const items: InGameLoadoutItem[] = [];
  const subclass = character.subclassItems.find((s) => s.equipped);
  if (subclass) {
    items.push({
      itemInstanceId: subclass.instanceId,
      itemHash: subclass.itemHash,
      plugs: { ...subclass.abilitySockets, ...subclass.aspectSockets, ...subclass.fragmentSockets },
    });
  }
  for (const w of weapons) if (onCharacter(w)) items.push({ itemInstanceId: w.instanceId, itemHash: w.itemHash });
  for (const p of pieces) {
    if (!onCharacter(p)) continue;
    const plugs: Record<number, number> = {};
    for (const socket of p.armorSockets ?? []) if (socket.plugHash !== undefined) plugs[socket.index] = socket.plugHash;
    items.push({ itemInstanceId: p.instanceId, itemHash: p.itemHash, plugs });
  }
  const artifact = character.artifacts?.find((a) => a.equipped);
  if (artifact) {
    items.push({ itemInstanceId: artifact.instanceId, itemHash: artifact.itemHash, plugs: artifact.perks });
  }
  return { index: -1, nameHash: 0, iconHash: 0, colorHash: 0, items, empty: items.length === 0 };
}

/** The name a save of equipped gear starts with: "Prismatic Hunter", or just the class. */
export function equippedGearName(character: Pick<ArmoryCharacter, "classType" | "equippedSubclass">): string {
  const className = CLASS_NAMES[character.classType] ?? "Guardian";
  const subclass = character.equippedSubclass?.subclass;
  return subclass ? `${subclass} ${className}` : className;
}

/** The character's equipped gear as a new loadout, ready for the save drawer. */
export function equippedGearAsLoadout(
  character: ArmoryCharacter,
  lookups: Omit<SlotGearLookups, "classType">,
): SavedLoadoutData {
  return inGameSlotToLoadout({
    slot: equippedGearSlot(character, [...lookups.pieceMap.values()], [...lookups.weaponMap.values()]),
    name: equippedGearName(character),
    classType: character.classType,
    ...lookups,
  });
}
