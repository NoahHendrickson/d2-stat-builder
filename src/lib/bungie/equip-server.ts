// Server half of moving / equipping / socketing gear, shared by /api/bungie/equip and
// /api/bungie/apply-loadout. Everything here runs with the user's own OAuth token, so
// Bungie enforces ownership; our job is sequencing, spacing, and readable errors.
import type { HttpClient } from "bungie-api-ts/http";
import {
  equipItems,
  insertSocketPlugFree,
  transferItem,
  type BungieMembershipType,
} from "bungie-api-ts/destiny2";
import { BungieHttpError } from "./http";
import {
  planEquipBatches,
  planTransfers,
  type EquipItemState,
  type SpareItems,
  type TransferAction,
} from "./equip-plan";

/** Bungie asks for ≥100ms between item actions; stay comfortably above it. */
const ACTION_SPACING_MS = 150;
/** …and ≥500ms between socket-plug actions. */
const PLUG_SPACING_MS = 600;

const SUCCESS = 1;

/** Friendly text for the PlatformErrorCodes an equip realistically returns. */
export const EQUIP_MESSAGES: Record<number, string> = {
  1623: "Item not found — your inventory may be stale, refresh your gear",
  1640: "That item can't be equipped right now",
  1641: "Only one exotic can be equipped at a time",
  1642: "No room on that character — free up inventory space",
  1671: "Can't equip during an activity — go to orbit or a social space",
};

/** DestinyNoRoomInDestination — the target bucket (character slot or vault) is full. */
const NO_ROOM = 1642;

/** Friendly text for the PlatformErrorCodes a vault↔character transfer realistically returns. */
const TRANSFER_MESSAGES: Record<number, string> = {
  1623: "Item not found — your inventory may be stale, refresh your gear", // DestinyItemNotFound
  1656: "Equipped on another character — equip something else on them first", // DestinyCannotPerformActionOnEquippedItem
  1660: "That item can't be transferred", // DestinyItemNotTransferrable
  1671: "Can't move items during an activity — go to orbit or a social space", // DestinyCannotPerformActionAtThisLocation
};
const VAULT_FULL_MESSAGE = "Vault is full — free up vault space";
const CHARACTER_FULL_MESSAGE = "No room on that character — free up inventory space";

function transferMessage(err: unknown, toVault: boolean): string {
  const code = err instanceof BungieHttpError ? err.code : undefined;
  if (code === NO_ROOM) return toVault ? VAULT_FULL_MESSAGE : CHARACTER_FULL_MESSAGE;
  return (
    (code !== undefined ? TRANSFER_MESSAGES[code] : undefined) ??
    (err instanceof Error ? err.message : "Transfer failed")
  );
}

/**
 * Friendly text for the PlatformErrorCodes a plug insert realistically returns
 * (values per bungie-api-ts `PlatformErrorCodes`).
 */
const PLUG_MESSAGES: Record<number, string> = {
  1623: "Item not found — refresh your gear", // DestinyItemNotFound
  1671: "Can't change mods during an activity — go to orbit or a social space", // DestinyCannotPerformActionAtThisLocation
  1676: "That mod can't go in that socket (or there isn't enough armor energy)", // DestinyFailedPlugInsertionRules
  1677: "Socket not found — refresh your gear", // DestinySocketNotFound
  1678: "Socket is locked — unlock it in-game first (e.g. a fragment slot)", // DestinySocketActionNotAllowed
  1680: "You don't own that mod (or it isn't unlocked this season)", // DestinyPlugItemNotAvailable
};
/** DestinySocketAlreadyHasPlug — the plug is already there, which is what we wanted. */
const SOCKET_ALREADY_HAS_PLUG = 1679;

export interface ItemResult {
  itemInstanceId: string;
  ok: boolean;
  message?: string;
  /** Instance ids of pieces vaulted off the target character to make room for this one. */
  vaulted?: string[];
}

export interface PlugRequest {
  itemInstanceId: string;
  socketIndex: number;
  plugItemHash: number;
}

export interface PlugResult extends PlugRequest {
  ok: boolean;
  message?: string;
}

/** POST /api/bungie/apply-loadout response. */
export interface ApplyResponse {
  equip: ItemResult[];
  plugs: PlugResult[];
}

/** One line of the apply-loadout NDJSON stream. */
export type ApplyStreamEvent =
  | { type: "item-start"; itemInstanceId: string }
  | { type: "item"; result: ItemResult }
  | { type: "plug-start"; plug: PlugRequest }
  | { type: "plug"; result: PlugResult }
  | { type: "done"; equip: ItemResult[]; plugs: PlugResult[] }
  | { type: "error"; error: string; reauth?: boolean };

export type EquipProgressEvent =
  | { phase: "start"; itemInstanceId: string }
  | { phase: "result"; result: ItemResult };

export type PlugProgressEvent =
  | { phase: "start"; plug: PlugRequest }
  | { phase: "result"; result: PlugResult };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Equipped items can't be transferred — give that case a clear message up front. */
function transferBlockReason(item: EquipItemState, targetId: string): string | null {
  if (item.location === "equipped" && item.characterId !== targetId) {
    return "Equipped on another character — equip something else on them first";
  }
  return null;
}

/**
 * Stage every item on `characterId` (vault hops as needed), then bulk-equip them
 * (or stop after staging when `mode` is "move"). A Bungie 401 is re-thrown so the
 * route can clear the session; every other failure becomes a per-item result.
 */
export async function stageAndEquip({
  http,
  membershipType,
  characterId,
  items,
  spares,
  mode = "equip",
  onProgress,
}: {
  http: HttpClient;
  membershipType: BungieMembershipType;
  characterId: string;
  items: EquipItemState[];
  /** Per staged item: same-slot pieces on the character we may vault to make room. */
  spares?: SpareItems;
  mode?: "move" | "equip";
  onProgress?: (event: EquipProgressEvent) => void;
}): Promise<ItemResult[]> {
  const failed = new Map<string, string>();
  /** Staged item → spares vaulted to make room for it. */
  const vaulted = new Map<string, string[]>();
  const started = new Set<string>();
  const emitted = new Set<string>();
  const start = (id: string) => {
    if (started.has(id)) return;
    started.add(id);
    onProgress?.({ phase: "start", itemInstanceId: id });
  };
  const emitResult = (result: ItemResult) => {
    if (emitted.has(result.itemInstanceId)) return;
    emitted.add(result.itemInstanceId);
    onProgress?.({ phase: "result", result });
  };

  for (const item of items) {
    const reason = transferBlockReason(item, characterId);
    if (reason) {
      failed.set(item.itemInstanceId, reason);
      start(item.itemInstanceId);
      emitResult({ itemInstanceId: item.itemInstanceId, ok: false, message: reason });
    }
  }

  // Stage every piece on the target character (sequential — Bungie rate limit).
  const actions = planTransfers(
    items.filter((i) => !failed.has(i.itemInstanceId)),
    characterId,
  );
  const transfer = (action: TransferAction) =>
    transferItem(http, {
      itemReferenceHash: action.itemReferenceHash,
      stackSize: 1,
      transferToVault: action.transferToVault,
      itemId: action.itemId,
      characterId: action.characterId,
      membershipType,
    });
  const isNoRoom = (err: unknown) => err instanceof BungieHttpError && err.code === NO_ROOM;

  /** Attach the spares vaulted for this item — on failures too, so nothing moves unreported. */
  const withVaulted = (result: ItemResult): ItemResult => {
    const ids = vaulted.get(result.itemInstanceId);
    return ids ? { ...result, vaulted: ids } : result;
  };

  for (const action of actions) {
    if (failed.has(action.itemId)) continue; // earlier hop failed
    start(action.itemId);
    // A hop onto the target can hit a full bucket (9 unequipped per slot). Vault one of
    // the client's same-slot spares and retry, until the spares run out. A spare Bungie
    // won't move (e.g. it turned out to be untransferable) is skipped for the next one;
    // a full vault (or any other error on the piece itself) ends the attempt.
    const pool = action.transferToVault ? [] : [...(spares?.[action.itemId] ?? [])];
    let message: string | undefined;
    for (;;) {
      try {
        await transfer(action);
        message = undefined;
        break;
      } catch (err) {
        if (err instanceof BungieHttpError && err.status === 401) throw err;
        message = transferMessage(err, action.transferToVault);
        if (!isNoRoom(err)) break;
      }
      let madeRoom = false;
      while (!madeRoom) {
        const spare = pool.shift();
        if (!spare) break;
        await sleep(ACTION_SPACING_MS);
        try {
          await transfer({
            itemId: spare.itemInstanceId,
            itemReferenceHash: spare.itemHash,
            transferToVault: true,
            characterId: action.characterId,
          });
          madeRoom = true;
          vaulted.set(action.itemId, [...(vaulted.get(action.itemId) ?? []), spare.itemInstanceId]);
        } catch (err) {
          if (err instanceof BungieHttpError && err.status === 401) throw err;
          if (isNoRoom(err)) {
            message = VAULT_FULL_MESSAGE;
            pool.length = 0; // nothing else will fit either
          } else {
            message = `Couldn't make room: ${transferMessage(err, true)}`;
          }
        }
      }
      if (!madeRoom) break;
      await sleep(ACTION_SPACING_MS);
    }
    if (message !== undefined) {
      failed.set(action.itemId, message);
      emitResult(withVaulted({ itemInstanceId: action.itemId, ok: false, message }));
    }
    await sleep(ACTION_SPACING_MS);
  }

  const stagedIds = items.map((i) => i.itemInstanceId).filter((id) => !failed.has(id));
  const results: ItemResult[] = [];
  if (mode === "move") {
    for (const id of stagedIds) {
      start(id);
      const result = withVaulted({ itemInstanceId: id, ok: true });
      results.push(result);
      emitResult(result);
    }
  } else if (stagedIds.length > 0) {
    const collect = async (ids: string[]) => {
      if (ids.length === 0) return;
      for (const id of ids) start(id);
      const res = await equipItems(http, { itemIds: ids, characterId, membershipType });
      for (const r of res.Response.equipResults ?? []) {
        const result = withVaulted({
          itemInstanceId: r.itemInstanceId,
          ok: r.equipStatus === SUCCESS,
          message:
            r.equipStatus === SUCCESS
              ? undefined
              : (EQUIP_MESSAGES[r.equipStatus] ?? `Equip failed (code ${r.equipStatus})`),
        });
        results.push(result);
        emitResult(result);
      }
    };
    // Legendaries first so a currently equipped exotic in another slot comes off
    // before the loadout's exotic is equipped (Bungie 1641 otherwise).
    const { first, second } = planEquipBatches(stagedIds, items);
    await collect(first);
    if (first.length > 0 && second.length > 0) await sleep(ACTION_SPACING_MS);
    await collect(second);
  }
  for (const [itemInstanceId, message] of failed) {
    const result = withVaulted({ itemInstanceId, ok: false, message });
    results.push(result);
    emitResult(result);
  }
  return results;
}

/**
 * Insert plugs one at a time (Bungie: ≥0.5s apart; character must be in orbit, a
 * social space, or offline). "Free" inserts cover armor mods, tuning, artifice, and
 * subclass fragments without Advanced Write Actions. A 401 is re-thrown; other errors
 * become per-plug results. After an in-activity error (1671) the remaining plugs are
 * reported with the same message instead of being attempted.
 */
export async function insertPlugs({
  http,
  membershipType,
  characterId,
  plugs,
  onProgress,
}: {
  http: HttpClient;
  membershipType: BungieMembershipType;
  characterId: string;
  plugs: PlugRequest[];
  onProgress?: (event: PlugProgressEvent) => void;
}): Promise<PlugResult[]> {
  const results: PlugResult[] = [];
  let inActivity = false;
  const emitResult = (result: PlugResult) => {
    results.push(result);
    onProgress?.({ phase: "result", result });
  };
  for (let i = 0; i < plugs.length; i++) {
    const plug = plugs[i];
    onProgress?.({ phase: "start", plug });
    if (inActivity) {
      emitResult({ ...plug, ok: false, message: PLUG_MESSAGES[1671] });
      continue;
    }
    try {
      await insertSocketPlugFree(http, {
        plug: {
          socketIndex: plug.socketIndex,
          socketArrayType: 0, // DestinySocketArrayType.Default
          plugItemHash: plug.plugItemHash,
        },
        itemId: plug.itemInstanceId,
        characterId,
        membershipType,
      });
      emitResult({ ...plug, ok: true });
    } catch (err) {
      if (err instanceof BungieHttpError && err.status === 401) throw err;
      const code = err instanceof BungieHttpError ? err.code : undefined;
      if (code === SOCKET_ALREADY_HAS_PLUG) {
        emitResult({ ...plug, ok: true });
        continue;
      }
      if (code === 1671) inActivity = true;
      emitResult({
        ...plug,
        ok: false,
        message:
          (code !== undefined ? PLUG_MESSAGES[code] : undefined) ??
          (err instanceof Error ? err.message : "Mod insert failed"),
      });
    }
    if (i < plugs.length - 1) await sleep(PLUG_SPACING_MS);
  }
  return results;
}
