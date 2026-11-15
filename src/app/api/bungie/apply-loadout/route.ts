import { NextResponse } from "next/server";
import { createBungieHttp, BungieHttpError } from "@/lib/bungie/http";
import { isBungieId, parseApplyTargets, parseEquipItems, parseSpares } from "@/lib/bungie/equip-route";
import {
  applyPlugTargets,
  summarize,
  type PlugOutcome,
  type PlugSummary,
} from "@/lib/bungie/apply-plugs-server";
import type { ApplyTargets, LivePlan } from "@/lib/loadouts/apply-targets";
import type { EquipItemState, SpareItems } from "@/lib/bungie/equip-plan";
import {
  ApplyCancelledError,
  stageAndEquip,
  type ApplyStreamEvent,
} from "@/lib/bungie/equip-server";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { isApplyCancelled, isApplyId } from "@/lib/loadouts/apply-cancel-store";

/**
 * A full apply is long: up to 11 items × (2 vault hops + up to 3 spares vaulted, each
 * followed by a retry) transfers at 150 ms spacing, plus a character-inventory read
 * when the live fallback runs, then one batch of parallel item reads (each target item's
 * live sockets), then every plug one at a time. Bungie often takes ~2 s
 * to answer each plug insert, so a big loadout (armor mods, subclass, artifact) runs
 * well past a minute. At 60 s Vercel killed the stream mid-way and the last mods were
 * never sent (10 of 49 production applies on 2026-10-31/11-01). 300 s is within the
 * Pro plan's Fluid limit, and the time is spent waiting on Bungie, so it costs little.
 */
export const maxDuration = 300;
/**
 * No plug insert starts later than this into the request. One insert can still take
 * ~16 s (three ~2 s attempts with two 5 s throttle waits), so this leaves room for it to
 * finish and for `done` to report the rest as not attempted, instead of the stream being
 * killed with no word on which plugs never went out.
 */
const PLUG_DEADLINE_MS = (maxDuration - 30) * 1000;

/**
 * 5 armor + 1 subclass + 3 weapons + 1 legendary weapon swapped in to free the exotic
 * slot + the artifact.
 */
const MAX_ITEMS = 11;

interface ApplyRequestBody {
  characterId: string;
  /** Armor, weapons, and the subclass item to stage + equip. May be empty when only plugs change. */
  items: EquipItemState[];
  /**
   * The state each item's sockets should end in. The server reads the items' live
   * sockets after equipping and works out the inserts itself (see apply-targets.ts).
   */
  targets: ApplyTargets;
  /** Same-slot pieces the server may vault when a character's slot is full. */
  spares: SpareItems;
  /** Client-made id the Cancel button flags (apply-loadout/cancel); none means no cancel. */
  applyId?: string;
}

/**
 * A page loaded before targets replaced the client-planned `plugs` list (2026-11-14)
 * still sends that list. It gets told to refresh rather than a bare "Invalid request".
 */
const STALE_PAGE_MESSAGE = "This page is out of date — refresh it and apply again";

function parseBody(body: unknown): ApplyRequestBody | null {
  const b = body as Partial<ApplyRequestBody> | null;
  if (!b || !isBungieId(b.characterId)) return null;
  const items = parseEquipItems(b.items ?? [], { min: 0, max: MAX_ITEMS });
  const targets = parseApplyTargets(b.targets, { maxItems: MAX_ITEMS });
  const spares = parseSpares(b.spares);
  if (!items || !targets || !spares) return null;
  if (items.length === 0 && targets.items.length === 0) return null;
  if (b.applyId !== undefined && !isApplyId(b.applyId)) return null;
  return { characterId: b.characterId, items, targets, spares, applyId: b.applyId };
}

type ApplyOutcomeKind = "done" | "cancelled" | "error";

/**
 * One line per apply, for reading apply health in the logs: counts, error codes and plug
 * hashes only — nothing that names the player.
 */
function logApply(line: {
  outcome: ApplyOutcomeKind;
  ms: number;
  equip: { ok: number; failed: number };
  plugs?: PlugSummary;
}) {
  console.info(`[apply-loadout] ${JSON.stringify(line)}`);
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
 * Apply a saved loadout: stage + equip the armor, weapons, and subclass, then bring each
 * target item's sockets to their target — mods / tuning / artifice / fragments / artifact
 * perks — planned from the items' live sockets, each insert checked once it's in.
 * Plugs for an item whose equip failed are skipped (and say so, with that item's
 * message) rather than attempted.
 *
 * Success is an NDJSON stream of `ApplyStreamEvent` so the client can watch each
 * transfer / equip / plug as it happens. Auth and validation failures stay JSON.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const body = parseBody(raw);
  if (!body) {
    const stale = !!raw && typeof raw === "object" && "plugs" in raw && !("targets" in raw);
    return NextResponse.json({ error: stale ? STALE_PAGE_MESSAGE : "Invalid request" }, { status: 400 });
  }

  const http = createBungieHttp(token);
  const membershipType = user.destinyMembershipType;
  const membershipId = user.destinyMembershipId;
  const { characterId, items, targets, spares, applyId } = body;
  const encoder = new TextEncoder();

  // The cancel flag lives in the database (another instance takes the cancel request),
  // so it's read at most once a second: a cancel lands within a step or two. The reads
  // go through the shared cache (isApplyCancelled), so the database sees one per apply.
  const cancelOwner = user.membershipId;
  let cancelled = false;
  let lastCancelCheck = 0;
  const shouldStop = applyId
    ? async () => {
        if (cancelled) return true;
        const now = Date.now();
        if (now - lastCancelCheck < 1000) return false;
        lastCancelCheck = now;
        cancelled = await isApplyCancelled(cancelOwner, applyId).catch(() => false);
        return cancelled;
      }
    : undefined;

  // For the one summary line each apply logs (see logApply).
  let outcome: ApplyOutcomeKind = "error";
  let equipCounts = { ok: 0, failed: 0 };
  let plan: LivePlan | undefined;
  /** Filled as each insert settles, so a cancelled or failed apply still logs what ran. */
  const outcomes: PlugOutcome[] = [];

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
        equipCounts = { ok: equip.filter((r) => r.ok).length, failed: failedItems.size };
        const out = await applyPlugTargets({
          http,
          membershipType,
          membershipId,
          characterId,
          targets,
          skip: failedItems,
          shouldStop,
          deadline: startedAt + PLUG_DEADLINE_MS,
          onPlanned: (p) => {
            plan = p;
            send({ type: "plugs-planned", plugs: p.plugs, inPlace: p.inPlace });
          },
          onOutcome: (o) => outcomes.push(o),
          onProgress: (event) => {
            if (event.phase === "start") send({ type: "plug-start", plug: event.plug });
            else send({ type: "plug", result: event.result });
          },
        });
        send({ type: "done", equip, plugs: out.outcomes.map((o) => o.result) });
        outcome = "done";
      } catch (err) {
        if (err instanceof ApplyCancelledError) {
          outcome = "cancelled";
          send({ type: "cancelled" });
          return;
        }
        // Cookies can't change once the stream has started, so unlike the equip route
        // the dead session isn't cleared here: the client signs out on `reauth`.
        send(streamError(err));
      } finally {
        logApply({
          outcome,
          ms: Date.now() - startedAt,
          equip: equipCounts,
          plugs: plan && summarize(targets.items.length, plan, outcomes),
        });
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
