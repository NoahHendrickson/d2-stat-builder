/**
 * Profile reads turned into a crawl's store (popularity-copies.ts): the
 * crawler's reads of players it found, and the inventories signed-in players
 * load on the site (popularity-contribution.ts), go through here alike, so a
 * copy is picked out and its perks read the same way whichever brought it.
 */

import {
  columnSockets,
  perksAtSockets,
  type CrawlSource,
  type PopularityLookup,
} from "./perk-popularity";
import { storeFromCrawl, type CopyStore, type SeenCopy, type SeenOwner } from "./popularity-copies";

/** One weapon copy as a profile lists it: its plug hashes by socket index, or undefined when the read had no sockets for it, and whether it was equipped (undefined only in a save from before that was kept, see popularity-contribution.ts). */
export interface ProfileCopy {
  itemHash: number;
  id: bigint;
  plugs: readonly (number | undefined)[] | undefined;
  equipped: boolean | undefined;
}

interface ItemRef {
  itemHash: number;
  itemInstanceId?: string;
}
type ItemsBy = Record<string, { items: readonly ItemRef[] }>;
/** The profile components a read of copies needs (DestinyProfileResponse fits). */
export interface ProfileRead {
  profileInventory?: { data?: { items: readonly ItemRef[] } };
  characterInventories?: { data?: ItemsBy };
  characterEquipment?: { data?: ItemsBy };
  itemComponents?: { sockets?: { data?: Record<string, { sockets: readonly { plugHash?: number }[] }> } };
}

/**
 * The instanced items of `profile` that `keep` takes (equipped, character
 * inventories, vault), each with its plugs by socket, and whether the read
 * saw everything: the equipment, the inventories, the vault and the sockets
 * all came back, and `keep` could tell every item (undefined: it couldn't).
 * A private vault or inventory comes back as just its privacy setting, no
 * `data`, so only a public or signed-in read sees everything.
 */
export function profileCopies(
  profile: ProfileRead,
  keep: (item: ItemRef & { itemInstanceId: string }) => boolean | undefined,
): { copies: ProfileCopy[]; sawAll: boolean } {
  const equipment = profile.characterEquipment?.data;
  const inventories = profile.characterInventories?.data;
  const vault = profile.profileInventory?.data?.items;
  const sockets = profile.itemComponents?.sockets?.data;
  let sawAll = equipment !== undefined && inventories !== undefined && vault !== undefined && sockets !== undefined;
  const copies: ProfileCopy[] = [];
  const placed = (list: readonly ItemRef[], equipped: boolean) => list.map((item) => ({ item, equipped }));
  const items = [
    ...placed(Object.values(equipment ?? {}).flatMap((c) => c.items), true),
    ...placed(Object.values(inventories ?? {}).flatMap((c) => c.items), false),
    ...placed(vault ?? [], false),
  ];
  for (const { item, equipped } of items) {
    const id = item.itemInstanceId;
    if (!id) continue;
    const kept = keep({ ...item, itemInstanceId: id });
    if (kept === undefined) sawAll = false;
    if (!kept) continue;
    copies.push({ itemHash: item.itemHash, id: BigInt(id), plugs: sockets?.[id]?.sockets.map((s) => s.plugHash), equipped });
  }
  return { copies, sawAll };
}

/**
 * Collects players and their copies of the tally's weapons (random-rolled
 * legendaries, the lookup's), then builds the crawl's store from them.
 */
export function readCollector(lookup: PopularityLookup) {
  const owners: SeenOwner[] = [];
  /** Each weapon's copies (with their owner; only ones with plugs), read into columns once every copy is in. */
  const copiesByWeapon = new Map<
    number,
    (Omit<ProfileCopy, "itemHash" | "plugs"> & { owner: number; plugs: NonNullable<ProfileCopy["plugs"]> })[]
  >();
  return {
    /** Players recorded so far. */
    players: () => owners.length,
    /** Weapons with a copy so far. */
    weapons: () => copiesByWeapon.size,
    /**
     * Records one player's read: every copy of the tally's weapons among
     * `copies`, several of one weapon included (a player keeping more than one
     * roll keeps each for a reason). The read is whole when it `sawAll` (vault
     * and inventories) and had every such copy's sockets: the merge then takes
     * anything of theirs it didn't list as dismantled. A player with none of
     * the tally's weapons is recorded only when `keep` (one the store knows,
     * whose read still says when they played and, whole, that they have none).
     */
    add(player: Omit<SeenOwner, "whole" | "sightedOnly">, copies: Iterable<ProfileCopy>, sawAll: boolean, keep: boolean) {
      const owner = owners.length;
      let found = 0;
      let unlisted = 0;
      for (const copy of copies) {
        if (!lookup.has(copy.itemHash)) continue;
        if (!copy.plugs) {
          unlisted++;
          continue;
        }
        const list = copiesByWeapon.get(copy.itemHash) ?? [];
        list.push({ id: copy.id, owner, plugs: copy.plugs, equipped: copy.equipped });
        copiesByWeapon.set(copy.itemHash, list);
        found++;
      }
      const whole = sawAll && unlisted === 0;
      if (found > 0 || keep) owners.push({ ...player, whole });
      return { found, whole };
    },
    /** A player the store knows, seen in a report but not read: proof they played on `played`. */
    sight(player: Pick<SeenOwner, "id" | "type" | "played">) {
      owners.push({ ...player, whole: false, sightedOnly: true });
    },
    /** The crawl as a store, read at `readAt` (ms) unless a player says otherwise; each weapon's columns read from the sockets learned from all its copies (see columnSockets). */
    store(readAt: number, run: CrawlSource): CopyStore {
      const perksByWeapon = new Map<number, SeenCopy[]>();
      for (const [hash, list] of copiesByWeapon) {
        const columns = lookup.get(hash)!;
        const placed = columnSockets(
          columns,
          list.map((copy) => copy.plugs),
        );
        perksByWeapon.set(
          hash,
          list.map(({ id, owner, plugs, equipped }) => ({ id, owner, perks: perksAtSockets(columns, placed, plugs), equipped })),
        );
      }
      return storeFromCrawl(owners, perksByWeapon, readAt, run);
    },
  };
}
