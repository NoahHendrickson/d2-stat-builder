// Weapons on a saved loadout. They are optional: a loadout may name none (armor only),
// or any of the three slots. They ride in `loadout.equipped` beside the armor and the
// subclass carrier — the dim-api shape — so Open in DIM and share links carry them too.
//
// Runtime imports are relative so the module runs under vitest.
import type { LoadoutWeapon } from "../armory/weapons";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";

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
