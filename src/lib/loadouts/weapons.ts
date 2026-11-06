// Weapons on a saved loadout. They are optional: a loadout may name none (armor only),
// or any of the three slots. They ride in `loadout.equipped` beside the armor and the
// subclass carrier — the dim-api shape — so Open in DIM and share links carry them too.
//
// Runtime imports are relative so the module runs under vitest.
import { weaponSlotOfHash, type LoadoutWeapon } from "../armory/weapons";
import { isArtifactHash } from "../armory/artifact-items";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import type { Manifest } from "../manifest/load";

type DefLookup = Pick<Manifest, "def">;

/** True for a weapon ref (its definition sits in a weapon bucket). */
export function isLoadoutWeaponRef(manifest: DefLookup, ref: DimLoadoutItem): boolean {
  return weaponSlotOfHash(manifest, ref.hash) !== undefined;
}

/** True for the artifact ref (it rides in `equipped` too). */
export function isLoadoutArtifactRef(manifest: DefLookup, ref: DimLoadoutItem): boolean {
  return isArtifactHash(manifest, ref.hash);
}

/** The loadout's weapon refs, as saved. */
export function loadoutWeaponRefs(manifest: DefLookup, loadout: DimLoadout): DimLoadoutItem[] {
  return loadout.equipped.filter((ref) => isLoadoutWeaponRef(manifest, ref));
}

/** The loadout's artifact ref, if it has one. */
export function loadoutArtifactRef(
  manifest: DefLookup,
  loadout: DimLoadout,
): DimLoadoutItem | undefined {
  return loadout.equipped.find((ref) => isLoadoutArtifactRef(manifest, ref));
}

/** Replace the loadout's weapon refs with `weapons` (an empty list makes it armor-only). */
export function withLoadoutWeapons(
  loadout: DimLoadout,
  weapons: DimLoadoutItem[],
  isWeapon: (ref: DimLoadoutItem) => boolean,
): DimLoadout {
  return {
    ...loadout,
    equipped: [...loadout.equipped.filter((ref) => !isWeapon(ref)), ...weapons],
  };
}

export interface ExoticWeaponSwap {
  /** A legendary to equip first, so the exotic it replaces comes off. */
  swap?: LoadoutWeapon;
  /** Why the loadout's exotic can't go on, when nothing can take the other one's place. */
  blocked?: string;
}

/**
 * Only one exotic weapon can be equipped, and Bungie's equip call won't take the old one
 * off for us (error 1641). When the loadout brings an exotic but leaves alone the slot
 * the character's current exotic sits in, pick a legendary for that slot to equip first:
 * one already on the character if there is one, else from the vault, else from another
 * character; the strongest of those. Nothing to do when the loadout fills that slot
 * itself, or carries no exotic.
 */
export function planExoticWeaponSwap(
  loadoutWeapons: readonly LoadoutWeapon[],
  owned: readonly LoadoutWeapon[],
  characterId: string,
): ExoticWeaponSwap {
  const incoming = loadoutWeapons.find((w) => w.isExotic);
  if (!incoming) return {};
  const filled = new Set(loadoutWeapons.map((w) => w.slot));
  const blocker = owned.find(
    (w) =>
      w.isExotic &&
      w.location === "equipped" &&
      w.characterId === characterId &&
      w.instanceId !== incoming.instanceId &&
      !filled.has(w.slot),
  );
  if (!blocker) return {};

  const rank = (w: LoadoutWeapon) =>
    w.characterId === characterId ? 0 : w.location === "vault" ? 1 : 2;
  const [swap] = owned
    .filter(
      (w) =>
        w.slot === blocker.slot &&
        !w.isExotic &&
        !w.postmaster &&
        // Equipped elsewhere can't be transferred; equipped here would be the blocker.
        w.location !== "equipped",
    )
    .sort((a, b) => rank(a) - rank(b) || (b.power ?? 0) - (a.power ?? 0));
  return swap
    ? { swap }
    : { blocked: `${blocker.name} is equipped and nothing else can take its slot` };
}
