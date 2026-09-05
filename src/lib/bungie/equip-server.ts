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
import { planTransfers, type EquipItemState } from "./equip-plan";

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

/** Friendly text for the PlatformErrorCodes a plug insert realistically returns. */
const PLUG_MESSAGES: Record<number, string> = {
  1623: "Item not found — refresh your gear",
  1650: "That mod can't go in that socket",
  1651: "Not enough armor energy — remove another mod first",
  1671: "Can't change mods during an activity — go to orbit or a social space",
  1679: "Socket is locked — the subclass can't hold that fragment yet",
};

export interface ItemResult {
  itemInstanceId: string;
  ok: boolean;
  message?: string;
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
  mode = "equip",
}: {
  http: HttpClient;
  membershipType: BungieMembershipType;
  characterId: string;
  items: EquipItemState[];
  mode?: "move" | "equip";
}): Promise<ItemResult[]> {
  const failed = new Map<string, string>();
  for (const item of items) {
    const reason = transferBlockReason(item, characterId);
    if (reason) failed.set(item.itemInstanceId, reason);
  }

  // Stage every piece on the target character (sequential — Bungie rate limit).
  const actions = planTransfers(
    items.filter((i) => !failed.has(i.itemInstanceId)),
    characterId,
  );
  for (const action of actions) {
    if (failed.has(action.itemId)) continue; // earlier hop failed
    try {
      await transferItem(http, {
        itemReferenceHash: action.itemReferenceHash,
        stackSize: 1,
        transferToVault: action.transferToVault,
        itemId: action.itemId,
        characterId: action.characterId,
        membershipType,
      });
    } catch (err) {
      if (err instanceof BungieHttpError && err.status === 401) throw err;
      failed.set(action.itemId, err instanceof Error ? err.message : "Transfer failed");
    }
    await sleep(ACTION_SPACING_MS);
  }

  const stagedIds = items.map((i) => i.itemInstanceId).filter((id) => !failed.has(id));
  const results: ItemResult[] = [];
  if (mode === "move") {
    for (const id of stagedIds) results.push({ itemInstanceId: id, ok: true });
  } else if (stagedIds.length > 0) {
    const res = await equipItems(http, { itemIds: stagedIds, characterId, membershipType });
    for (const r of res.Response.equipResults ?? []) {
      results.push({
        itemInstanceId: r.itemInstanceId,
        ok: r.equipStatus === SUCCESS,
        message:
          r.equipStatus === SUCCESS
            ? undefined
            : (EQUIP_MESSAGES[r.equipStatus] ?? `Equip failed (code ${r.equipStatus})`),
      });
    }
  }
  for (const [itemInstanceId, message] of failed) {
    results.push({ itemInstanceId, ok: false, message });
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
}: {
  http: HttpClient;
  membershipType: BungieMembershipType;
  characterId: string;
  plugs: PlugRequest[];
}): Promise<PlugResult[]> {
  const results: PlugResult[] = [];
  let inActivity = false;
  for (let i = 0; i < plugs.length; i++) {
    const plug = plugs[i];
    if (inActivity) {
      results.push({ ...plug, ok: false, message: PLUG_MESSAGES[1671] });
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
      results.push({ ...plug, ok: true });
    } catch (err) {
      if (err instanceof BungieHttpError && err.status === 401) throw err;
      const code = err instanceof BungieHttpError ? err.code : undefined;
      if (code === 1671) inActivity = true;
      results.push({
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
