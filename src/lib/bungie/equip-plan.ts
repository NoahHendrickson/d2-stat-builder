import type { ArmorLocation } from "@/lib/armory/normalize";

/** What the client knows about a piece's whereabouts when it asks to equip. */
export interface EquipItemState {
  itemInstanceId: string;
  itemHash: number;
  location: ArmorLocation;
  characterId?: string;
  /**
   * Armor exotic. EquipItems rejects a new exotic (1641) while another is still on a
   * different slot, so we equip legendaries first to swap that piece off.
   */
  isExotic?: boolean;
}

/** One TransferItem call: move `itemId` to/from the vault for `characterId`. */
export interface TransferAction {
  itemId: string;
  itemReferenceHash: number;
  transferToVault: boolean;
  characterId: string;
}

/**
 * The ordered TransferItem calls that stage every piece on the target character.
 * Bungie only moves items vault↔character, so: already on the target → nothing;
 * in the vault → one hop; on another character → two hops through the vault.
 *
 * A piece *equipped* on another character can't be transferred at all (Bungie
 * rejects moving equipped items) — planning it anyway lets the per-item error
 * from Bungie surface with a clear message rather than silently skipping.
 */
export function planTransfers(
  items: EquipItemState[],
  targetCharacterId: string,
): TransferAction[] {
  const actions: TransferAction[] = [];
  for (const item of items) {
    if (item.characterId === targetCharacterId) continue;
    const base = { itemId: item.itemInstanceId, itemReferenceHash: item.itemHash };
    if (item.location !== "vault" && item.characterId) {
      actions.push({ ...base, transferToVault: true, characterId: item.characterId });
    }
    actions.push({ ...base, transferToVault: false, characterId: targetCharacterId });
  }
  return actions;
}

/**
 * Split staged ids so legendaries (and subclass) go on first, then exotics.
 * EquipItems is not sequential: mixing a new exotic with a still-equipped exotic
 * in another slot returns 1641. The legendary pass unequips that piece when the
 * loadout has a replacement for its slot.
 */
export function planEquipBatches(
  stagedIds: string[],
  items: EquipItemState[],
): { first: string[]; second: string[] } {
  const exotic = new Set(
    items.filter((i) => i.isExotic).map((i) => i.itemInstanceId),
  );
  const first: string[] = [];
  const second: string[] = [];
  for (const id of stagedIds) {
    if (exotic.has(id)) second.push(id);
    else first.push(id);
  }
  return { first, second };
}

/** How many pieces we'll vault per slot before giving up on making room. */
export const MAX_SPARES_PER_ITEM = 3;

/**
 * Pieces the server may vault to make room, keyed by the staged item they make room
 * for. Bungie caps each armor bucket at 9 unequipped pieces, so a transfer onto a full
 * character fails with DestinyNoRoomInDestination; vaulting one same-slot piece frees it.
 */
export type SpareItems = Record<string, EquipItemState[]>;

interface SparePiece {
  instanceId: string;
  itemHash: number;
  slot: string;
  location: ArmorLocation;
  characterId?: string;
  isExotic: boolean;
}

/**
 * For every staged item that needs a hop onto `targetCharacterId`, list the unequipped
 * same-slot pieces already sitting on that character that aren't part of this equip.
 * Non-exotics go first so a legendary is vaulted before an exotic. Items we can't find
 * in `pieces` (the subclass, unknown ids) get no spares.
 */
export function planSpares(
  pieces: Iterable<SparePiece>,
  items: EquipItemState[],
  targetCharacterId: string,
): SpareItems {
  const byId = new Map<string, SparePiece>();
  for (const p of pieces) byId.set(p.instanceId, p);
  const staged = new Set(items.map((i) => i.itemInstanceId));
  const spares: SpareItems = {};
  for (const item of items) {
    if (item.characterId === targetCharacterId) continue;
    const piece = byId.get(item.itemInstanceId);
    if (!piece) continue;
    const candidates: SparePiece[] = [];
    for (const p of byId.values()) {
      if (
        p.slot === piece.slot &&
        p.location === "inventory" &&
        p.characterId === targetCharacterId &&
        !staged.has(p.instanceId)
      ) {
        candidates.push(p);
      }
    }
    candidates.sort((a, b) => Number(a.isExotic) - Number(b.isExotic));
    if (candidates.length === 0) continue;
    spares[item.itemInstanceId] = candidates.slice(0, MAX_SPARES_PER_ITEM).map((p) => ({
      itemInstanceId: p.instanceId,
      itemHash: p.itemHash,
      location: p.location,
      characterId: p.characterId,
    }));
  }
  return spares;
}
