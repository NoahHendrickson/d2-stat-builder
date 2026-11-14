// The socket half of /api/bungie/apply-loadout: read each target item's live sockets,
// plan the inserts from them (apply-targets.ts), run them, then check each one stayed
// in. A plug Bungie accepted but that isn't in its socket afterwards gets one more try.
import type { HttpClient } from "bungie-api-ts/http";
import { getItem, type BungieMembershipType, type DestinyComponentType } from "bungie-api-ts/destiny2";
import { BungieHttpError } from "./http";
import { withThrottleRetry } from "./throttle";
import {
  plugInserter,
  type PlugInserterOptions,
  type PlugProgressEvent,
  type PlugRequest,
  type PlugResult,
} from "./equip-server";
import {
  planFromLive,
  type ApplyTargets,
  type LiveItem,
  type LivePlan,
  type LiveSocket,
} from "../loadouts/apply-targets";

/** ItemInstances (energy) + ItemSockets (what's plugged). */
const LIVE_COMPONENTS = [300, 305] as DestinyComponentType[];

export const NOT_STUCK_MESSAGE =
  "Bungie accepted it, but it didn't stay in the socket — apply again";

/**
 * Each item's live sockets and energy, one GetItem per item, all at once: reads aren't
 * item actions, so Bungie's spacing rules don't apply. An item that can't be read is
 * left out (the caller falls back to the client's copy); a 401 is re-thrown.
 */
export async function readLiveItems({
  http,
  membershipType,
  membershipId,
  itemInstanceIds,
}: {
  http: HttpClient;
  membershipType: BungieMembershipType;
  membershipId: string;
  itemInstanceIds: readonly string[];
}): Promise<Map<string, LiveItem>> {
  const out = new Map<string, LiveItem>();
  await Promise.all(
    [...new Set(itemInstanceIds)].map(async (itemInstanceId) => {
      try {
        const res = await withThrottleRetry(() =>
          getItem(http, {
            membershipType,
            destinyMembershipId: membershipId,
            itemInstanceId,
            components: LIVE_COMPONENTS,
          }),
        );
        const item = liveItemFrom(res?.Response);
        if (item) out.set(itemInstanceId, item);
      } catch (err) {
        if (err instanceof BungieHttpError && err.status === 401) throw err;
      }
    }),
  );
  return out;
}

/** A DestinyItemResponse (GetItem, or an insert's `item`) → its sockets + energy; undefined without sockets. */
function liveItemFrom(response: unknown): LiveItem | undefined {
  const r = response as
    | {
        sockets?: { data?: { sockets?: LiveSocket[] } };
        instance?: { data?: { energy?: { energyCapacity: number; energyUsed: number } } };
      }
    | undefined;
  const sockets = r?.sockets?.data?.sockets;
  if (!Array.isArray(sockets)) return undefined;
  const energy = r?.instance?.data?.energy;
  return {
    sockets,
    ...(energy ? { energy: { capacity: energy.energyCapacity, used: energy.energyUsed } } : {}),
  };
}

/** The plug an insert's DestinyItemChangeResponse shows in `socketIndex`; undefined when it doesn't say. */
export function plugInResponse(response: unknown, socketIndex: number): number | undefined {
  const item = liveItemFrom((response as { item?: unknown } | undefined)?.item);
  if (!item) return undefined;
  return item.sockets[socketIndex]?.plugHash ?? 0;
}

/** Counts for the one log line an apply writes. Hashes and counts only. */
export interface PlugSummary {
  /** Items targeted, and how many of them were planned from the client's copy. */
  items: number;
  readFailed: number;
  /** Inserts planned from live state, and targets already in place. */
  sent: number;
  inPlace: number;
  /** Inserts that are in place at the end. */
  inserted: number;
  retried: number;
  failed: number;
  /** Not attempted because the piece's equip failed. */
  skipped: number;
  /** Verified from the insert's own response, from a re-read, or not at all (re-read failed). */
  verified: { response: number; reread: number; unverified: number };
  overEnergy: number;
  /** PlatformErrorCode → how many inserts ended with it. */
  codes: Record<number, number>;
  failedHashes: number[];
}

/**
 * Plan and run the socket targets after equipping. `skip` maps an item whose equip failed
 * to that failure: its inserts are reported as skipped, not attempted (and its sockets
 * aren't read — the client's copy is enough to say what was skipped). Results come back
 * in plan order: one per planned insert.
 */
export async function applyPlugTargets({
  targets,
  membershipId,
  skip,
  onPlanned,
  onProgress,
  ...inserter
}: PlugInserterOptions & {
  targets: ApplyTargets;
  membershipId: string;
  skip: ReadonlyMap<string, string>;
  onPlanned?: (plan: LivePlan) => void;
  onProgress?: (event: PlugProgressEvent) => void;
}): Promise<{ plan: LivePlan; results: PlugResult[]; summary: PlugSummary }> {
  const { http, membershipType } = inserter;
  const readIds = targets.items.map((t) => t.itemInstanceId).filter((id) => !skip.has(id));
  const live = await readLiveItems({ http, membershipType, membershipId, itemInstanceIds: readIds });
  const plan = planFromLive(targets, (id) => live.get(id));
  onPlanned?.(plan);

  const summary: PlugSummary = {
    items: targets.items.length,
    readFailed: readIds.filter((id) => !live.has(id)).length,
    sent: plan.plugs.length,
    inPlace: plan.inPlace.length,
    inserted: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    verified: { response: 0, reread: 0, unverified: 0 },
    overEnergy: plan.overEnergy.length,
    codes: {},
    failedHashes: [],
  };
  const results: (PlugResult | undefined)[] = plan.plugs.map(() => undefined);
  const settle = (i: number, result: Omit<PlugResult, keyof PlugRequest>, code?: number) => {
    const full: PlugResult = { ...toRequest(plan.plugs[i]), ...result };
    results[i] = full;
    if (full.ok) summary.inserted++;
    else if (skip.has(full.itemInstanceId)) summary.skipped++;
    else {
      summary.failed++;
      summary.failedHashes.push(full.plugItemHash);
      if (code !== undefined) summary.codes[code] = (summary.codes[code] ?? 0) + 1;
    }
    onProgress?.({ phase: "result", result: full });
  };

  const insert = plugInserter(inserter);
  /** The last planned insert into each socket: only its plug should be there at the end. */
  const lastInSocket = new Map<string, number>();
  plan.plugs.forEach((p, i) => lastInSocket.set(socketKey(p), i));

  /**
   * Insert `indices` in order; settle each that is known in place or failed, and return
   * the ones still to check: `recheck` (Bungie's answer didn't show the socket) and
   * `missing` (it showed another plug there).
   */
  const run = async (indices: number[], lastTry: boolean) => {
    const recheck: number[] = [];
    const missing: number[] = [];
    for (const i of indices) {
      const plug = toRequest(plan.plugs[i]);
      const attempt = await insert(plug, () => onProgress?.({ phase: "start", plug }));
      if (!attempt.ok) settle(i, { ok: false, message: attempt.message }, attempt.code);
      else if (attempt.alreadyThere) settle(i, { ok: true });
      else {
        const seen = plugInResponse(attempt.response, plug.socketIndex);
        if (seen === undefined) recheck.push(i);
        else {
          summary.verified.response++;
          if (seen === plug.plugItemHash) settle(i, { ok: true });
          else if (lastTry) settle(i, { ok: false, message: NOT_STUCK_MESSAGE });
          else missing.push(i);
        }
      }
    }
    return { recheck, missing };
  };

  /** Re-read the items behind `indices` and settle what's in place; returns the rest. */
  const reread = async (indices: number[], lastTry: boolean) => {
    if (indices.length === 0) return [];
    const ids = indices.map((i) => plan.plugs[i].itemInstanceId);
    const now = await readLiveItems({ http, membershipType, membershipId, itemInstanceIds: ids });
    const missing: number[] = [];
    for (const i of indices) {
      const plug = plan.plugs[i];
      const item = now.get(plug.itemInstanceId);
      if (!item) {
        // Bungie said it went in and won't show us otherwise: take its word.
        summary.verified.unverified++;
        settle(i, { ok: true });
        continue;
      }
      summary.verified.reread++;
      // A later insert into the same socket (an artifact perk freed, then replaced) owns
      // what's there now: this one did its job if either plug is in.
      const last = plan.plugs[lastInSocket.get(socketKey(plug)) ?? i];
      const there = item.sockets[plug.socketIndex]?.plugHash;
      if (there === plug.plugItemHash || there === last.plugItemHash) settle(i, { ok: true });
      else if (lastTry) settle(i, { ok: false, message: NOT_STUCK_MESSAGE });
      else missing.push(i);
    }
    return missing;
  };

  const runnable: number[] = [];
  plan.plugs.forEach((p, i) => {
    const reason = skip.get(p.itemInstanceId);
    if (reason === undefined) {
      runnable.push(i);
      return;
    }
    onProgress?.({ phase: "start", plug: toRequest(p) });
    settle(i, { ok: false, message: `Skipped — its armor piece wasn't equipped (${reason})` });
  });

  const first = await run(runnable, false);
  const retry = [...first.missing, ...(await reread(first.recheck, false))].sort((a, b) => a - b);
  summary.retried = retry.length;
  if (retry.length > 0) {
    const second = await run(retry, true);
    await reread(second.recheck, true);
  }

  return {
    plan,
    // Every index is settled by now; the filter only satisfies the type.
    results: results.filter((r): r is PlugResult => r !== undefined),
    summary,
  };
}

const socketKey = (p: PlugRequest) => `${p.itemInstanceId}:${p.socketIndex}`;

const toRequest = ({ itemInstanceId, socketIndex, plugItemHash }: PlugRequest): PlugRequest => ({
  itemInstanceId,
  socketIndex,
  plugItemHash,
});
