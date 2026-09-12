// Resolve a saved loadout's item references against the live armory + manifest for
// display and apply. Mirrors DIM's ResolvedLoadoutItem: an item the player no longer
// owns still renders (from its definition) but is flagged `missing`, and the row's
// item actions are disabled until every piece resolves.
//
// Runtime imports are relative so the module runs under vitest.
import type { ArmorPiece } from "../armory/normalize";
import type { Subclass } from "../armory/fragments";
import { isSyntheticClassItemId } from "../armory/exotic-class-perks";
import { ARMOR_BUCKETS, ARMOR_SLOTS, type ArmorSlot } from "../armory/stats";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import { ABILITY_KINDS, ASPECT_SOCKET_COUNT, FRAGMENT_SOCKET_COUNT, FRAGMENT_SOCKET_START, SUPER_SOCKET_COUNT, aspectSocketStart, subclassFromItemHash, type AbilityKind } from "../dim/subclasses";
import { abilitySocketIndex, selectedSubclassPlugs } from "./subclass";

/** The manifest access this module needs (keeps tests free of a full Manifest). */
export interface DefLookup {
  def(
    table: "DestinyInventoryItemDefinition" | "DestinySocketTypeDefinition",
    hash: number | undefined | null,
  ):
    | {
        displayProperties?: { name?: string; icon?: string };
        inventory?: { bucketTypeHash?: number };
        sockets?: { socketEntries: { singleInitialItemHash: number; socketTypeHash?: number }[] };
        socketCategoryHash?: number;
        plugWhitelist?: { categoryIdentifier: string }[];
        plug?: { plugCategoryIdentifier?: string };
      }
    | undefined;
}

export interface ResolvedArmorItem {
  ref: DimLoadoutItem;
  /** The live piece, when the instance is still in the armory. */
  piece?: ArmorPiece;
  name: string;
  icon?: string;
  /** Slot from the live piece, else from the definition's bucket. */
  slot?: ArmorSlot;
  missing: boolean;
}

export interface ResolvedSubclass {
  itemHash: number;
  subclass?: Subclass;
  /** Fragment plug hashes from the carrier's socketOverrides, in socket order. */
  fragmentHashes: number[];
  aspectHashes: number[];
  /** Super plug hash when the loadout specifies one. */
  superHash?: number;
  /** Every ability the loadout pins (Super included), by kind. Unpinned kinds are absent. */
  abilityHashes: Partial<Record<AbilityKind, number>>;
  socketOverrides: Record<number, number>;
}

export interface ResolvedLoadout {
  /** Armor entries in ARMOR_SLOTS order where the slot is known; unknown slots last. */
  armor: ResolvedArmorItem[];
  subclass?: ResolvedSubclass;
  /** True when any armor piece failed to resolve to a live instance. */
  missing: boolean;
  /** Every armor piece resolved and none is a synthetic (theoretical) roll. */
  actionable: boolean;
}

/** D2ArmorPicker / DIM convention: the fragments carrier uses this fake instance id. */
const SUBCLASS_FAKE_ID = "12345";

export function resolveLoadout(
  loadout: DimLoadout,
  pieceMap: ReadonlyMap<string, ArmorPiece>,
  manifest: DefLookup,
): ResolvedLoadout {
  const armor: ResolvedArmorItem[] = [];
  let subclass: ResolvedSubclass | undefined;

  for (const ref of loadout.equipped) {
    const sc = subclassFromItemHash(ref.hash);
    if (sc || ref.id === SUBCLASS_FAKE_ID) {
      // Subclass carrier — fragments live in socketOverrides from the subclass's first
      // fragment socket onward.
      const start = sc ? FRAGMENT_SOCKET_START[sc] : 0;
      const sockets = manifest.def("DestinyInventoryItemDefinition", ref.hash)?.sockets?.socketEntries;
      // Sockets in a group share one empty plug — the group's first socket's initial plug.
      const group = (start: number, count: number) => ({ start, count, emptyHash: sockets?.[start]?.singleInitialItemHash });
      const fragmentHashes = selectedSubclassPlugs(ref, group(start, FRAGMENT_SOCKET_COUNT));
      const aspectHashes = sc ? selectedSubclassPlugs(ref, group(aspectSocketStart(sc), ASPECT_SOCKET_COUNT)) : [];
      const abilityHashes: Partial<Record<AbilityKind, number>> = {};
      for (const kind of ABILITY_KINDS) {
        const start = abilitySocketIndex(manifest, ref.hash, kind);
        const hash = start !== undefined ? selectedSubclassPlugs(ref, group(start, SUPER_SOCKET_COUNT))[0] : undefined;
        if (hash !== undefined) abilityHashes[kind] = hash;
      }
      subclass = { itemHash: ref.hash, subclass: sc, fragmentHashes, aspectHashes, superHash: abilityHashes.super, abilityHashes, socketOverrides: ref.socketOverrides ?? {} };
      continue;
    }
    const piece = ref.id ? pieceMap.get(ref.id) : undefined;
    const def = manifest.def("DestinyInventoryItemDefinition", ref.hash);
    armor.push({
      ref,
      piece,
      name: piece?.name ?? def?.displayProperties?.name ?? "Unknown item",
      icon: piece?.icon ?? def?.displayProperties?.icon,
      slot:
        piece?.slot ??
        ARMOR_BUCKETS[def?.inventory?.bucketTypeHash as keyof typeof ARMOR_BUCKETS],
      missing: !piece,
    });
  }

  const order = new Map(ARMOR_SLOTS.map((s, i) => [s, i]));
  armor.sort(
    (a, b) => (a.slot ? order.get(a.slot)! : 99) - (b.slot ? order.get(b.slot)! : 99),
  );

  const missing = armor.some((a) => a.missing);
  const actionable =
    armor.length > 0 &&
    !missing &&
    !armor.some((a) => a.ref.id !== undefined && isSyntheticClassItemId(a.ref.id));
  return { armor, subclass, missing, actionable };
}
