import { NextResponse } from "next/server";
import { createBungieHttp, BungieHttpError } from "@/lib/bungie/http";
import { isBungieId, parseEquipItems, parseSpares } from "@/lib/bungie/equip-route";
import type { EquipItemState, SpareItems } from "@/lib/bungie/equip-plan";
import {
  ApplyCancelledError,
  insertPlugs,
  stageAndEquip,
  type ApplyStreamEvent,
  type PlugRequest,
  type PlugResult,
} from "@/lib/bungie/equip-server";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import { FRAGMENT_SOCKET_COUNT } from "@/lib/armory/equipped-subclass";
import { MAX_MODS } from "@/lib/loadouts/types";
import { ABILITY_SOCKET_COUNT, ASPECT_SOCKET_COUNT } from "@/lib/dim/subclasses";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { getApplyCancelStore, isApplyId } from "@/lib/loadouts/apply-cancel-store";

/** 7 perk inserts, plus an empty plug for each perk that moves to another socket. */
const ARTIFACT_PLUGS = 14;

/**
 * A full apply is long: up to 11 items × (2 vault hops + up to 3 spares vaulted, each
 * followed by a retry) transfers at 150 ms spacing, plus a character-inventory read
 * when the live fallback runs (repeated only after a failed read), then every plug at
 * 600 ms spacing —
 * 30 s+ of deliberate pacing before Bungie's own latency. The default serverless limit (10 s) would cut the stream
 * mid-flight and leave the character half-applied.
 */
export const maxDuration = 60;

/**
 * 5 armor + 1 subclass + 3 weapons + 1 legendary weapon swapped in to free the exotic
 * slot + the artifact.
 */
const MAX_ITEMS = 11;
/**
 * Every mod a loadout may list (stat / tuning / artifice / slot-specific — the same cap
 * the loadout parser enforces) plus every subclass socket a loadout can pin: abilities,
 * aspects, and fragments. Anything the client plans within a valid loadout must fit, or
 * a fully-specified build could never be applied. Then the artifact's perks.
 */
const MAX_PLUGS =
  MAX_MODS + ABILITY_SOCKET_COUNT + ASPECT_SOCKET_COUNT + FRAGMENT_SOCKET_COUNT + ARTIFACT_PLUGS;

interface ApplyRequestBody {
  characterId: string;
  /** Armor, weapons, and the subclass item to stage + equip. May be empty when only plugs change. */
  items: EquipItemState[];
  /** Socket inserts to run after equipping (planned client-side, see apply-plan.ts). */
  plugs: PlugRequest[];
  /** Same-slot pieces the server may vault when a character's slot is full. */
  spares: SpareItems;
  /** Client-made id the Cancel button flags (apply-loadout/cancel); none means no cancel. */
  applyId?: string;
}

function parsePlugs(v: unknown): PlugRequest[] | null {
  if (!Array.isArray(v) || v.length > MAX_PLUGS) return null;
  for (const p of v as Partial<PlugRequest>[]) {
    if (
      !isBungieId(p?.itemInstanceId) ||
      !Number.isInteger(p.socketIndex) ||
      (p.socketIndex as number) < 0 ||
      !Number.isInteger(p.plugItemHash)
    )
      return null;
  }
  return v as PlugRequest[];
}

function parseBody(body: unknown): ApplyRequestBody | null {
  const b = body as Partial<ApplyRequestBody> | null;
  if (!b || !isBungieId(b.characterId)) return null;
  const items = parseEquipItems(b.items ?? [], { min: 0, max: MAX_ITEMS });
  const plugs = parsePlugs(b.plugs ?? []);
  const spares = parseSpares(b.spares);
  if (!items || !plugs || !spares || (items.length === 0 && plugs.length === 0)) return null;
  if (b.applyId !== undefined && !isApplyId(b.applyId)) return null;
  return { characterId: b.characterId, items, plugs, spares, applyId: b.applyId };
}

function streamError(err: unknown): Extract<ApplyStreamEvent, { type: "error" }> {
  if (err instanceof BungieHttpError && err.status === 401) {
    return {
      type: "error",
      error: "Bungie needs new permissions — sign in again to allow equipping",
      reauth: true,
    };
  }
  return {
    type: "error",
    error: err instanceof Error ? err.message : "Bungie request failed",
  };
}

/**
 * Apply a saved loadout: stage + equip the armor, weapons, and subclass, then socket the
 * planned mods / tuning / artifice / fragments. Plugs for an item whose equip failed
 * are skipped (and say so, with that item's message) rather than attempted.
 *
 * Success is an NDJSON stream of `ApplyStreamEvent` so the client can watch each
 * transfer / equip / plug as it happens. Auth and validation failures stay JSON.
 */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: ApplyRequestBody | null = null;
  try {
    body = parseBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const http = createBungieHttp(token);
  const membershipType = user.destinyMembershipType;
  const membershipId = user.destinyMembershipId;
  const { characterId, items, plugs: requestedPlugs, spares, applyId } = body;
  const encoder = new TextEncoder();

  // The cancel flag lives in the database (another instance takes the cancel request),
  // so it's read at most once a second: a cancel lands within a step or two, and a
  // 40-plug apply costs a few dozen tiny reads, not one per Bungie call.
  const cancelStore = getApplyCancelStore();
  const cancelOwner = user.membershipId;
  let cancelled = false;
  let lastCancelCheck = 0;
  const shouldStop = applyId
    ? async () => {
        if (cancelled) return true;
        const now = Date.now();
        if (now - lastCancelCheck < 1000) return false;
        lastCancelCheck = now;
        cancelled = await cancelStore.isCancelled(cancelOwner, applyId).catch(() => false);
        return cancelled;
      }
    : undefined;

  // Once the client goes away (tab closed, connection dropped) the controller rejects
  // every enqueue; keep applying — Bungie is mid-way through the character — but stop
  // writing so the stream doesn't throw its way out of the handler.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      closed = true;
    },
    async start(controller) {
      const send = (event: ApplyStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        const equip =
          items.length > 0
            ? await stageAndEquip({
                http,
                membershipType,
                membershipId,
                characterId,
                items,
                spares,
                shouldStop,
                onProgress: (event) => {
                  if (event.phase === "start") {
                    send({ type: "item-start", itemInstanceId: event.itemInstanceId });
                  } else {
                    send({ type: "item", result: event.result });
                  }
                },
              })
            : [];

        const failedItems = new Map(
          equip.filter((r) => !r.ok).map((r) => [r.itemInstanceId, r.message ?? "Equip failed"]),
        );
        const runnable = requestedPlugs.filter((p) => !failedItems.has(p.itemInstanceId));
        const skippedPlugs: PlugResult[] = requestedPlugs
          .filter((p) => failedItems.has(p.itemInstanceId))
          .map((p) => {
            const result = {
              ...p,
              ok: false,
              message: `Skipped — its armor piece wasn't equipped (${failedItems.get(p.itemInstanceId)})`,
            };
            send({ type: "plug", result });
            return result;
          });
        const plugResults = await insertPlugs({
          http,
          membershipType,
          characterId,
          plugs: runnable,
          shouldStop,
          onProgress: (event) => {
            if (event.phase === "start") send({ type: "plug-start", plug: event.plug });
            else send({ type: "plug", result: event.result });
          },
        });
        send({ type: "done", equip, plugs: [...plugResults, ...skippedPlugs] });
      } catch (err) {
        if (err instanceof ApplyCancelledError) {
          send({ type: "cancelled" });
          return;
        }
        // Cookies can't change once the stream has started, so unlike the equip route
        // the dead session isn't cleared here: the client signs out on `reauth`.
        send(streamError(err));
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by a failed enqueue.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
