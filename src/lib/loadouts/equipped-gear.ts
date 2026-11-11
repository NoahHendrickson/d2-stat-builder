// What a character has equipped right now, as a loadout: the subclass with its
// abilities / aspects / fragments, the weapons, the armor with the mods socketed on it,
// and the artifact with its perks. Goes through the same conversion as importing an
// in-game slot (gearToLoadout).
//
// Runtime imports are relative so the module runs under vitest.
import type { ArmoryCharacter } from "../armory/fetch";
import type { ArmorPiece } from "../armory/normalize";
import { CLASS_NAMES } from "../armory/stats";
import type { LoadoutWeapon } from "../armory/weapons";
import type { InGameLoadoutItem } from "../bungie/ingame-loadouts";
import { gearToLoadout, type SlotGearLookups } from "./ingame-import";
import { MAX_NAME_LENGTH, type SavedLoadoutData } from "./types";

type GearCharacter = Pick<ArmoryCharacter, "id" | "classType" | "subclassItems" | "artifacts">;

const equippedSubclass = (character: Pick<ArmoryCharacter, "subclassItems">) =>
  character.subclassItems.find((s) => s.equipped);

/**
 * The character's equipped gear, every item with its live plugs. Armor names each
 * socket, so an empty tuning or artifice socket is saved as empty (Apply then clears
 * it) rather than left out; see piecePlacement in ingame-import.ts.
 */
export function equippedGearItems(
  character: Omit<GearCharacter, "classType">,
  pieces: readonly ArmorPiece[],
  weapons: readonly LoadoutWeapon[],
): InGameLoadoutItem[] {
  const onCharacter = (g: { location: string; characterId?: string }) =>
    g.location === "equipped" && g.characterId === character.id;
  const items: InGameLoadoutItem[] = [];
  const subclass = equippedSubclass(character);
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
  return items;
}

/** The name a save of equipped gear starts with: "Prismatic Hunter", or just the class. */
export function equippedGearName(character: Pick<ArmoryCharacter, "classType" | "subclassItems">): string {
  const className = CLASS_NAMES[character.classType] ?? "Guardian";
  const subclass = equippedSubclass(character)?.subclass;
  return subclass ? `${subclass} ${className}` : className;
}

/** `name`, or `name 2`, `name 3`, … when a loadout already has it (ignoring case). */
export function uniqueLoadoutName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const fit = (suffix: string) => `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
  let candidate = fit("");
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = fit(` ${n}`);
  return candidate;
}

export interface EquippedGearInput extends Omit<SlotGearLookups, "classType"> {
  pieces: readonly ArmorPiece[];
  weapons: readonly LoadoutWeapon[];
  /** Names already in use, so a second save of the same setup gets its own. */
  existingNames: readonly string[];
}

/** The character's equipped gear as a new loadout. */
export function equippedGearAsLoadout(
  character: GearCharacter,
  { pieces, weapons, existingNames, ...lookups }: EquippedGearInput,
): SavedLoadoutData {
  return gearToLoadout({
    items: equippedGearItems(character, pieces, weapons),
    name: uniqueLoadoutName(equippedGearName(character), existingNames),
    classType: character.classType,
    ...lookups,
  });
}
