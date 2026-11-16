// The socket half of /api/bungie/apply-loadout: read each target item's live sockets,
// plan the inserts from them (apply-targets.ts), then run them one at a time, checking
// each stayed in before the next. A plug Bungie accepted that isn't in its socket (or
// can't be checked) gets one more try.
import type { HttpClient } from "bungie-api-ts/http";
import {
  getItem,
  type BungieMembershipType,
  type DestinyComponentType,
  type DestinyItemChangeResponse,
  type DestinyItemResponse,
} from "bungie-api-ts/destiny2";
import { BungieHttpError } from "./http";
import { withThrottleRetry } from "./throttle";
import {
  plugInserter,
  type PlugAttempt,
  type PlugInserterOptions,
  type PlugProgressEvent,
  type PlugRequest,
  type PlugResult,
} from "./equip-server";
import {
  planFromLive,
  type ApplyTargets,
  type ItemTarget,
  type LiveItem,
  type LivePlan,
} from "../loadouts/apply-targets";

/** ItemInstances (energy) + ItemSockets (what's plugged). */
const LIVE_COMPONENTS = [300, 305] as DestinyComponentType[];

export const NOT_STUCK_MESSAGE =
  "Bungie accepted it, but it didn't stay in the socket — apply again";
export const UNCHECKED_MESSAGE =
  "Bungie accepted it, but couldn't show whether it went in — refresh your gear to check";

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
function liveItemFrom(response: DestinyItemResponse | undefined): LiveItem | undefined {
  const sockets = response?.sockets?.data?.sockets;
  if (!Array.isArray(sockets)) return undefined;
  const energy = response?.instance?.data?.energy;
  return {
    sockets,
    ...(energy ? { energy: { capacity: energy.energyCapacity, used: energy.energyUsed } } : {}),
  };
}

/** The plug an insert's answer shows in `socketIndex`; undefined when it doesn't say. */
export function plugInResponse(
  response: DestinyItemChangeResponse | undefined,
  socketIndex: number,
): number | undefined {
  const item = liveItemFrom(response?.item);
  if (!item) return undefined;
  return item.sockets[socketIndex]?.plugHash ?? 0;
}

/**
 * How a plug's placement was told: from the insert's own answer, a re-read of the item,
 * Bungie's "already has that plug" (1679), or not at all (neither said).
 */
export type CheckedBy = "response" | "reread" | "already" | "unchecked";

/** One planned insert, settled. */
export interface PlugOutcome {
  result: PlugResult;
  /** Bungie's PlatformErrorCode, when an attempt failed with one. */
  code?: number;
  retried: boolean;
  /** Absent when the insert failed before anything could be checked, or was skipped. */
  checkedBy?: CheckedBy;
  /** Not attempted: the item's equip failed. */
  skipped?: true;
}

/** Counts for the one log line an apply writes. Hashes and counts only. */
export interface PlugSummary {
  items: number;
  /** Items Bungie didn't return, planned from the client's copy. */
  readFailed: number;
  /** Inserts planned from live state, and targets already in place. */
  sent: number;
  inPlace: number;
  /** Inserts that are in place at the end. */
  inserted: number;
  retried: number;
  failed: number;
  /** Not attempted because the item's equip failed. */
  skipped: number;
  /** One count per settled plug: how its placement was told. */
  checked: Record<CheckedBy, number>;
  overEnergy: number;
  /** PlatformErrorCode → how many inserts ended with it. */
  codes: Record<number, number>;
  failedHashes: number[];
}

/** The log line's counts, from the plan and whatever outcomes there are (a cancelled apply has some). */
export function summarize(items: number, plan: LivePlan, outcomes: readonly PlugOutcome[]): PlugSummary {
  const summary: PlugSummary = {
    items,
    readFailed: plan.fromSnapshot.length,
    sent: plan.plugs.length,
    inPlace: plan.inPlace.length,
    inserted: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    checked: { response: 0, reread: 0, already: 0, unchecked: 0 },
    overEnergy: plan.overEnergy.length,
    codes: {},
    failedHashes: [],
  };
  for (const o of outcomes) {
    if (o.retried) summary.retried++;
    if (o.checkedBy) summary.checked[o.checkedBy]++;
    if (o.code !== undefined) summary.codes[o.code] = (summary.codes[o.code] ?? 0) + 1;
    if (o.result.ok) summary.inserted++;
    else if (o.skipped) summary.skipped++;
    else {
      summary.failed++;
      summary.failedHashes.push(o.result.plugItemHash);
    }
  }
  return summary;
}

const SKIPPED_ITEM: Record<ItemTarget["kind"], string> = {
  armor: "its armor piece",
  subclass: "the subclass",
  artifact: "the artifact",
};

/**
 * Plan and run the socket targets after equipping. `skip` maps an item whose equip failed
 * to that failure: its inserts are reported as skipped, not attempted. Every item is read,
 * so plugs already in place are reported in place even on a skipped one. Outcomes come
 * back (and through `onOutcome`, as each settles) in plan order: one per planned insert.
 */
export async function applyPlugTargets({
  targets,
  membershipId,
  skip,
  onPlanned,
  onOutcome,
  onProgress,
  ...inserter
}: PlugInserterOptions & {
  targets: ApplyTargets;
  membershipId: string;
  skip: ReadonlyMap<string, string>;
  onPlanned?: (plan: LivePlan) => void;
  onOutcome?: (outcome: PlugOutcome) => void;
  onProgress?: (event: PlugProgressEvent) => void;
}): Promise<{ plan: LivePlan; outcomes: PlugOutcome[] }> {
  const { http, membershipType } = inserter;
  const read = (ids: string[]) => readLiveItems({ http, membershipType, membershipId, itemInstanceIds: ids });
  const live = await read(targets.items.map((t) => t.itemInstanceId));
  const plan = planFromLive(targets, (id) => live.get(id));
  onPlanned?.(plan);

  const insert = plugInserter(inserter);
  /** Is the plug in after an insert Bungie accepted? `inPlace` undefined: it can't be told. */
  const check = async (
    plug: PlugRequest,
    attempt: Extract<PlugAttempt, { ok: true }>,
  ): Promise<{ inPlace?: boolean; by: CheckedBy }> => {
    if (attempt.alreadyThere) return { inPlace: true, by: "already" };
    const seen = plugInResponse(attempt.response, plug.socketIndex);
    if (seen !== undefined) return { inPlace: seen === plug.plugItemHash, by: "response" };
    const item = (await read([plug.itemInstanceId])).get(plug.itemInstanceId);
    if (!item) return { by: "unchecked" };
    return { inPlace: (item.sockets[plug.socketIndex]?.plugHash ?? 0) === plug.plugItemHash, by: "reread" };
  };
  const failed = (plug: PlugRequest, message: string): PlugResult => ({ ...plug, ok: false, message });

  /** Insert, check, and (once) retry one plug: done before the next, which may depend on it. */
  const attemptPlug = async (plug: PlugRequest): Promise<PlugOutcome> => {
    const start = () => onProgress?.({ phase: "start", plug });
    const first = await insert(plug, start);
    if (!first.ok) return { result: failed(plug, first.message), code: first.code, retried: false };
    const before = await check(plug, first);
    if (before.inPlace) return { result: { ...plug, ok: true }, retried: false, checkedBy: before.by };

    const second = await insert(plug, start);
    if (!second.ok) {
      // A retry that couldn't go out (out of time, throttled) says nothing about the first try.
      const message = before.inPlace === undefined ? UNCHECKED_MESSAGE : second.message;
      return { result: failed(plug, message), code: second.code, retried: true, checkedBy: before.by };
    }
    const after = await check(plug, second);
    if (after.inPlace) return { result: { ...plug, ok: true }, retried: true, checkedBy: after.by };
    const message = after.inPlace === false ? NOT_STUCK_MESSAGE : UNCHECKED_MESSAGE;
    return { result: failed(plug, message), retried: true, checkedBy: after.by };
  };

  const kindOf = new Map(targets.items.map((t) => [t.itemInstanceId, t.kind]));
  const outcomes: PlugOutcome[] = [];
  for (const { itemInstanceId, socketIndex, plugItemHash } of plan.plugs) {
    const plug: PlugRequest = { itemInstanceId, socketIndex, plugItemHash };
    const reason = skip.get(itemInstanceId);
    let outcome: PlugOutcome;
    if (reason === undefined) outcome = await attemptPlug(plug);
    else {
      onProgress?.({ phase: "start", plug });
      const what = SKIPPED_ITEM[kindOf.get(itemInstanceId) ?? "armor"];
      outcome = { result: failed(plug, `Skipped — ${what} wasn't equipped (${reason})`), retried: false, skipped: true };
    }
    outcomes.push(outcome);
    onOutcome?.(outcome);
    onProgress?.({ phase: "result", result: outcome.result });
  }
  return { plan, outcomes };
}
