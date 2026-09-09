import { NextResponse } from "next/server";
import { createBungieHttp, BungieHttpError } from "@/lib/bungie/http";
import { parseEquipItems, parseSpares } from "@/lib/bungie/equip-route";
import type { EquipItemState, SpareItems } from "@/lib/bungie/equip-plan";
import {
  insertPlugs,
  stageAndEquip,
  type ApplyStreamEvent,
  type PlugRequest,
  type PlugResult,
} from "@/lib/bungie/equip-server";
import { clearSession, getValidAccessToken, readUser } from "@/lib/bungie/session";
import { FRAGMENT_SOCKET_COUNT } from "@/lib/armory/equipped-subclass";
import { MAX_MODS } from "@/lib/loadouts/types";
import { ABILITY_SOCKET_COUNT, ASPECT_SOCKET_COUNT } from "@/lib/dim/subclasses";

/** 5 armor + 1 subclass. */
const MAX_ITEMS = 6;
/**
 * Every mod a loadout may list (stat / tuning / artifice / slot-specific — the same cap
 * the loadout parser enforces) plus every subclass socket a loadout can pin: abilities,
 * aspects, and fragments. Anything the client plans within a valid loadout must fit, or
 * a fully-specified build could never be applied.
 */
const MAX_PLUGS = MAX_MODS + ABILITY_SOCKET_COUNT + ASPECT_SOCKET_COUNT + FRAGMENT_SOCKET_COUNT;

interface ApplyRequestBody {
  characterId: string;
  /** Armor (and the subclass item) to stage + equip. May be empty when only plugs change. */
  items: EquipItemState[];
  /** Socket inserts to run after equipping (planned client-side, see apply-plan.ts). */
  plugs: PlugRequest[];
  /** Same-slot pieces the server may vault when a character's slot is full. */
  spares: SpareItems;
}

function parsePlugs(v: unknown): PlugRequest[] | null {
  if (!Array.isArray(v) || v.length > MAX_PLUGS) return null;
  for (const p of v as Partial<PlugRequest>[]) {
    if (
      typeof p?.itemInstanceId !== "string" ||
      !p.itemInstanceId ||
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
  if (!b || typeof b.characterId !== "string" || !b.characterId) return null;
  const items = parseEquipItems(b.items ?? [], { min: 0, max: MAX_ITEMS });
  const plugs = parsePlugs(b.plugs ?? []);
  const spares = parseSpares(b.spares);
  if (!items || !plugs || !spares || (items.length === 0 && plugs.length === 0)) return null;
  return { characterId: b.characterId, items, plugs, spares };
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
 * Apply a saved loadout: stage + equip the armor (and subclass), then socket the
 * planned mods / tuning / artifice / fragments. Plugs for an item whose equip failed
 * are skipped (and say so, with that item's message) rather than attempted.
 *
 * Success is an NDJSON stream of `ApplyStreamEvent` so the client can watch each
 * transfer / equip / plug as it happens. Auth and validation failures stay JSON.
 */
export async function POST(request: Request) {
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
  const { characterId, items, plugs: requestedPlugs, spares } = body;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ApplyStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const equip =
          items.length > 0
            ? await stageAndEquip({
                http,
                membershipType,
                characterId,
                items,
                spares,
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
          onProgress: (event) => {
            if (event.phase === "start") send({ type: "plug-start", plug: event.plug });
            else send({ type: "plug", result: event.result });
          },
        });
        send({ type: "done", equip, plugs: [...plugResults, ...skippedPlugs] });
      } catch (err) {
        const event = streamError(err);
        if (event.reauth) await clearSession();
        send(event);
      } finally {
        controller.close();
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
