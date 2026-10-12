// Turn one of the game's own loadout slots (profile component 206) into a saved
// loadout: the subclass with its abilities / aspects / fragments, the weapons, the
// armor, and the armor mods the slot puts on each piece.
//
// Runtime imports are relative so the module runs under vitest.
import type { ArmorPiece } from "../armory/normalize";
import { ARMOR_BUCKETS, ARMOR_SLOTS, plugKindForCategory, type StatArray } from "../armory/stats";
import { WEAPON_BUCKETS, WEAPON_SLOTS, type LoadoutWeapon } from "../armory/weapons";
import type { InGameLoadoutItem, InGameLoadoutSlot } from "../bungie/ingame-loadouts";
import type { DimLoadoutItem } from "../dim/loadout-link";
import { subclassFromItemHash } from "../dim/subclasses";
import type { Manifest } from "../manifest/load";
import { sumEditorStats, withEditorTotals } from "./editor-stats";
import { placementToMods } from "./mod-placement";
import { selectedSubclassPlugs, subclassOptions } from "./subclass";
import {
  LOADOUT_SCHEMA_VERSION,
  MAX_NAME_LENGTH,
  type ModPlacement,
  type SavedLoadoutData,
} from "./types";

/** dim-api AssumeArmorMasterwork.All — what every other saved loadout here uses. */
const ASSUME_MASTERWORK_ALL = 3;

/** What a slot is saved as unless the player renames it: the name the game shows. */
export function inGameImportName(slot: InGameLoadoutSlot, names: { hash: number; name: string }[]): string {
  const name = names.find((n) => n.hash === slot.nameHash)?.name;
  return (name || `Loadout ${slot.index + 1}`).slice(0, MAX_NAME_LENGTH);
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

/** The mods the slot puts on a piece, by socket — empty plugs and cosmetics left out. */
function piecePlacement(item: InGameLoadoutItem, piece: ArmorPiece, manifest: Manifest): Record<number, number> {
  const out: Record<number, number> = {};
  for (const socket of piece.armorSockets ?? []) {
    const hash = item.plugs?.[socket.index];
    if (hash === undefined || hash === socket.emptyPlugHash) continue;
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
  const armorOrder = (a: (typeof armor)[number]) => {
    const slot = a.piece?.slot ?? ARMOR_BUCKETS[bucketOf(a.ref.hash) as keyof typeof ARMOR_BUCKETS];
    return slot ? ARMOR_SLOTS.indexOf(slot) : ARMOR_SLOTS.length;
  };
  armor.sort((a, b) => armorOrder(a) - armorOrder(b));
  const weaponOrder = (ref: DimLoadoutItem) => {
    const slot = weaponMap.get(ref.id ?? "")?.slot ?? WEAPON_BUCKETS[bucketOf(ref.hash)];
    return slot ? WEAPON_SLOTS.indexOf(slot) : WEAPON_SLOTS.length;
  };
  weapons.sort((a, b) => weaponOrder(a) - weaponOrder(b));

  const pieces = armor.flatMap((a) => (a.piece ? [a.piece] : []));
  const exotic = pieces.find((p) => p.isExotic);
  const data: SavedLoadoutData = {
    version: LOADOUT_SCHEMA_VERSION,
    loadout: {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, MAX_NAME_LENGTH),
      classType,
      equipped: [...armor.map((a) => a.ref), ...weapons, ...(subclass ? [subclass] : [])],
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
  const baseStats = [0, 0, 0, 0, 0, 0] as StatArray;
  for (const p of pieces) for (let i = 0; i < 6; i++) baseStats[i] += p.stats[i];
  // The game averages power over everything equipped; the weapons count when known.
  const powers = [
    ...pieces.map((p) => p.power),
    ...weapons.map((w) => weaponMap.get(w.id ?? "")?.power),
  ].filter((p): p is number => p !== undefined);
  const none = pieces.map(() => null);
  return withEditorTotals(
    {
      ...data,
      optimizer: {
        pieceIds: pieces.map((p) => p.instanceId),
        baseStats: baseStats.map((v) => Math.min(200, v)) as StatArray,
        stats: totals.stats,
        tuningBonus: [0, 0, 0, 0, 0, 0],
        tuning: none,
        modBonus: [0, 0, 0, 0, 0, 0],
        modsUsed: { major: 0, minor: 0 },
        artificeBonus: [0, 0, 0, 0, 0, 0],
        artifice: none,
        total: totals.total,
        exotic: !!exotic,
        power: powers.length > 0 ? Math.floor(powers.reduce((a, b) => a + b, 0) / powers.length) : null,
      },
    },
    totals,
  );
}
