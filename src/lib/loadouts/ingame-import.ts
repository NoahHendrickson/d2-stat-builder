// Turn one of the game's own loadout slots (profile component 206) into a saved
// loadout: the subclass with its abilities / aspects / fragments, the weapons, the
// armor, the armor mods the slot puts on each piece, and the artifact with its perks.
//
// Runtime imports are relative so the module runs under vitest.
import { ARTIFACT_BUCKET, artifactPerkSockets } from "../armory/artifact-items";
import type { ArmorPiece, ArmorSocket } from "../armory/normalize";
import { ARMOR_BUCKETS, ARMOR_SLOTS, plugKindForCategory } from "../armory/stats";
import { WEAPON_BUCKETS, WEAPON_SLOTS, type LoadoutWeapon } from "../armory/weapons";
import type { InGameLoadoutItem, InGameLoadoutSlot } from "../bungie/ingame-loadouts";
import { ASSUME_MASTERWORK_ALL, type DimLoadoutItem } from "../dim/loadout-link";
import { subclassFromItemHash } from "../dim/subclasses";
import type { Manifest } from "../manifest/load";
import { loadoutPower } from "../optimizer/power";
import { optimizerFromEditorTotals, sumEditorStats } from "./editor-stats";
import { isPlaceholderPlug } from "./mod-options";
import { placementToMods } from "./mod-placement";
import { selectedSubclassPlugs, subclassOptions } from "./subclass";
import {
  LOADOUT_SCHEMA_VERSION,
  MAX_NAME_LENGTH,
  type ModPlacement,
  type SavedLoadoutData,
} from "./types";

/** What a slot is saved as unless the player renames it: the name the game shows. */
export function inGameImportName(slot: InGameLoadoutSlot, names: { hash: number; name: string }[]): string {
  const name = names.find((n) => n.hash === slot.nameHash)?.name;
  return (name || `Loadout ${slot.index + 1}`).slice(0, MAX_NAME_LENGTH);
}

/**
 * Where an item sits when a loadout's gear is listed: subclass, then weapons, then
 * armor, each in slot order, then the artifact; anything else last.
 */
export function slotItemOrder(manifest: Manifest, itemHash: number): number {
  if (subclassFromItemHash(itemHash)) return 0;
  const bucket = manifest.def("DestinyInventoryItemDefinition", itemHash)?.inventory?.bucketTypeHash ?? 0;
  const weapon = WEAPON_BUCKETS[bucket];
  if (weapon) return 1 + WEAPON_SLOTS.indexOf(weapon);
  const armor = ARMOR_BUCKETS[bucket as keyof typeof ARMOR_BUCKETS];
  if (armor) return 1 + WEAPON_SLOTS.length + ARMOR_SLOTS.indexOf(armor);
  if (bucket === ARTIFACT_BUCKET) return 1 + WEAPON_SLOTS.length + ARMOR_SLOTS.length;
  return 99;
}

/**
 * The subclass carrier: only the sockets this app models (abilities, aspects,
 * fragments), and only plugs that subclass can take — anything else would make the
 * editor refuse to save the loadout.
 */
function subclassRef(item: InGameLoadoutItem, itemHash: number, classType: number, manifest: Manifest): DimLoadoutItem {
  const subclass = subclassFromItemHash(itemHash);
  const plugs = item.plugs ?? {};
  if (!subclass) return { hash: itemHash };
  const options = subclassOptions(manifest, classType, subclass);
  const socketOverrides: Record<number, number> = {};
  for (const group of [...Object.values(options.abilities), options.aspects, options.fragments]) {
    for (let i = group.start; i < group.start + group.count; i++) {
      const hash = plugs[i];
      if (hash === undefined) continue;
      if (hash === group.emptyHash || group.options.some((o) => o.hash === hash)) {
        socketOverrides[i] = hash;
      }
    }
  }
  return Object.keys(socketOverrides).length > 0 ? { hash: itemHash, socketOverrides } : { hash: itemHash };
}

/** The artifact with the perks the slot puts in its perk sockets (the editor's shape). */
function artifactRef(item: InGameLoadoutItem, itemHash: number, manifest: Manifest): DimLoadoutItem {
  const socketOverrides: Record<number, number> = {};
  for (const socket of artifactPerkSockets(manifest, itemHash)) {
    const hash = item.plugs?.[socket.index];
    if (hash !== undefined && socket.options.includes(hash)) socketOverrides[socket.index] = hash;
  }
  return { id: item.itemInstanceId, hash: itemHash, socketOverrides };
}

/** Is `hash` this socket's empty plug ("Empty Mod Socket" and the like)? */
function isEmptyPlug(socket: ArmorSocket, hash: number, manifest: Manifest): boolean {
  if (hash === socket.emptyPlugHash) return true;
  // Not every socket definition names its empty plug; those are known by doing nothing.
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  return !!def && isPlaceholderPlug(def);
}

/**
 * The mods the slot puts on a piece, by socket. A socket the slot leaves alone keeps
 * what is socketed now, the way equipping the slot in-game does. An empty mod socket is
 * left out — Apply clears energy-costing leftovers anyway — but an empty tuning or
 * artifice socket is kept as its empty plug: Apply leaves those 0-cost plugs in place
 * unless the loadout names the socket. Cosmetics (shaders, ornaments) are left out.
 */
function piecePlacement(item: InGameLoadoutItem, piece: ArmorPiece, manifest: Manifest): Record<number, number> {
  const out: Record<number, number> = {};
  for (const socket of piece.armorSockets ?? []) {
    const set = item.plugs?.[socket.index];
    const hash = set ?? socket.plugHash;
    if (hash === undefined) continue;
    if (isEmptyPlug(socket, hash, manifest)) {
      const zeroCost = socket.kind === "tuning" || socket.kind === "artifice";
      if (zeroCost && set !== undefined && hash === socket.emptyPlugHash) out[socket.index] = hash;
      continue;
    }
    const category = manifest.def("DestinyInventoryItemDefinition", hash)?.plug?.plugCategoryIdentifier;
    if (category && plugKindForCategory(category)) out[socket.index] = hash;
  }
  return out;
}

export interface InGameImportInput {
  slot: InGameLoadoutSlot;
  name: string;
  classType: number;
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  weaponMap: ReadonlyMap<string, LoadoutWeapon>;
  manifest: Manifest;
}

/**
 * The saved-loadout payload for an in-game slot. Items the player no longer has (no
 * item hash) are left out; an armor piece the armory doesn't know is kept by reference
 * (it shows as missing) without its mods. When all five armor pieces are live, the
 * stat totals are filled in the way the Edit drawer computes them, so the card shows
 * the build's stats like an optimizer save does.
 */
export function inGameSlotToLoadout({
  slot,
  name,
  classType,
  pieceMap,
  weaponMap,
  manifest,
}: InGameImportInput): SavedLoadoutData {
  const bucketOf = (hash: number) =>
    manifest.def("DestinyInventoryItemDefinition", hash)?.inventory?.bucketTypeHash ?? 0;
  let subclass: DimLoadoutItem | undefined;
  let artifact: DimLoadoutItem | undefined;
  const weapons: DimLoadoutItem[] = [];
  const armor: { ref: DimLoadoutItem; piece?: ArmorPiece }[] = [];
  const placement: ModPlacement = {};

  for (const item of slot.items) {
    const hash = item.itemHash;
    if (hash === undefined) continue;
    if (subclassFromItemHash(hash)) {
      subclass = subclassRef(item, hash, classType, manifest);
      continue;
    }
    const bucket = bucketOf(hash);
    if (bucket === ARTIFACT_BUCKET) {
      artifact = artifactRef(item, hash, manifest);
      continue;
    }
    const ref = { id: item.itemInstanceId, hash };
    if (WEAPON_BUCKETS[bucket] || weaponMap.has(item.itemInstanceId)) {
      weapons.push(ref);
      continue;
    }
    const piece = pieceMap.get(item.itemInstanceId);
    if (!piece && !(bucket in ARMOR_BUCKETS)) continue; // ghost, emblem, …: not part of a saved loadout
    armor.push({ ref, ...(piece ? { piece } : {}) });
    if (piece) {
      const sockets = piecePlacement(item, piece, manifest);
      if (Object.keys(sockets).length > 0) placement[piece.instanceId] = sockets;
    }
  }

  // The game's own order varies; saved loadouts list armor and weapons in slot order.
  const order = (ref: DimLoadoutItem) => slotItemOrder(manifest, ref.hash);
  armor.sort((a, b) => order(a.ref) - order(b.ref));
  weapons.sort((a, b) => order(a) - order(b));

  const pieces = armor.flatMap((a) => (a.piece ? [a.piece] : []));
  const exotic = pieces.find((p) => p.isExotic);
  const data: SavedLoadoutData = {
    version: LOADOUT_SCHEMA_VERSION,
    loadout: {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, MAX_NAME_LENGTH),
      classType,
      equipped: [
        ...armor.map((a) => a.ref),
        ...weapons,
        ...(artifact ? [artifact] : []),
        ...(subclass ? [subclass] : []),
      ],
      unequipped: [],
      parameters: {
        mods: placementToMods(placement, pieces),
        ...(exotic ? { exoticArmorHash: exotic.itemHash } : {}),
        assumeArmorMasterwork: ASSUME_MASTERWORK_ALL,
      },
    },
    ...(Object.keys(placement).length > 0 ? { modPlacement: placement } : {}),
  };

  const fullSet = pieces.length === ARMOR_SLOTS.length && new Set(pieces.map((p) => p.slot)).size === ARMOR_SLOTS.length;
  if (!fullSet) return data;

  const sc = subclass && subclassFromItemHash(subclass.hash);
  const fragmentHashes = sc
    ? selectedSubclassPlugs(subclass ?? null, subclassOptions(manifest, classType, sc).fragments)
    : [];
  const totals = sumEditorStats(pieces, placement, fragmentHashes, classType, (hash) =>
    manifest.def("DestinyInventoryItemDefinition", hash)?.investmentStats,
  );
  // The game averages power over everything equipped; the weapons count when known.
  const weaponPowers = weapons.flatMap((w) => {
    const power = weaponMap.get(w.id ?? "")?.power;
    return power === undefined ? [] : [power];
  });
  return {
    ...data,
    optimizer: optimizerFromEditorTotals(pieces, totals, {
      exotic: !!exotic,
      power: loadoutPower(pieces, weaponPowers),
    }),
  };
}
