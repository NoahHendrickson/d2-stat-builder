"use client";

// The inventory manager's move queue. Moves show up at once (an op laid over the
// profile), run against Bungie one at a time, and the profile is refetched once the
// queue drains. The ops stay laid over the profile until a fetch reflects them, because
// Bungie's profile cache can hand back the old layout for a while after a move.
import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast, type PendingToast } from "@/lib/toast";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import { profileKey } from "@/lib/armory/keys";
import type { MoveDestination, MoveSource } from "@/lib/bungie/move-plan";
import type { MoveResult } from "@/lib/bungie/move-server";
import { createValueStore } from "@/lib/value-store";
import type { InventoryItem, ManagerInventory } from "./build";
import { moveProblem, type Landing, type MoveOp, type Place } from "./moves";

export const moveOps = createValueStore<readonly MoveOp[]>([]);

/** Wait this long after the last move before refetching, so a burst of drags refetches once. */
const REFETCH_DELAY_MS = 1500;

let nextId = 1;
let queue: Promise<void> = Promise.resolve();
let inFlight = 0;
let refetchTimer: ReturnType<typeof setTimeout> | undefined;

function updateOp(id: number, patch: Partial<MoveOp> | null) {
  moveOps.set(
    patch === null
      ? moveOps.get().filter((o) => o.id !== id)
      : moveOps.get().map((o) => (o.id === id ? { ...o, ...patch } : o)),
  );
}

function source(place: Place): MoveSource {
  if (place.kind === "postmaster") return { kind: "postmaster", characterId: place.characterId };
  if (place.kind === "character") {
    return { kind: "character", characterId: place.characterId, equipped: place.equipped };
  }
  return { kind: "vault" };
}

function destination(to: Landing): MoveDestination {
  return to.kind === "vault"
    ? { kind: "vault" }
    : { kind: "character", characterId: to.characterId, equip: Boolean(to.equipped) };
}

export interface MoveContext {
  queryClient: QueryClient;
  membershipId: string | undefined;
}

/** Items the player moved themselves in the last few minutes (smart moves leave them be). */
const RECENT_MS = 10 * 60_000;
const recent = new Map<string, number>();

export function recentlyMoved(now = Date.now()): Set<string> {
  for (const [key, at] of recent) if (now - at > RECENT_MS) recent.delete(key);
  return new Set(recent.keys());
}

/**
 * Move `item` from `place` to `to`: checked locally first (a refusal is a toast and
 * nothing moves), then shown moved straight away and queued for Bungie.
 */
export function requestMove(
  inventory: ManagerInventory,
  item: InventoryItem,
  place: Place,
  to: Landing,
  ctx: MoveContext,
): void {
  const problem = moveProblem(inventory, item, place, to);
  if (problem) {
    toast.error(`Can't move ${item.name}`, problem);
    return;
  }
  void requestMoves([{ item, place, to }], ctx);
}

/** How a queued move went: `title` and `message` say what failed. */
export type MoveOutcome = { ok: true } | { ok: false; title: string; message: string };

export interface MoveToastOptions {
  /** Where it's going, for the toast ("your Warlock", "the vault"). */
  where?: string;
  /**
   * The toast that reports it: omitted, the move gets its own spinner that turns into
   * the outcome; false, it reports nothing (the caller toasts a batch as a whole).
   */
  notify?: PendingToast | false;
}

/**
 * Queue moves that depend on each other (a smart move's prep steps, then the move):
 * all shown at once, sent in order, and if one fails the rest are dropped. The last
 * step is the move the player asked for; the others are "making room" for it.
 */
export function requestMoves(
  steps: readonly { item: InventoryItem; place: Place; to: Landing }[],
  ctx: MoveContext,
  { where, notify }: MoveToastOptions = {},
): Promise<MoveOutcome> {
  if (steps.length === 0) return Promise.resolve({ ok: true });
  const last = steps[steps.length - 1]!;
  const main = last.item;
  const equip = last.to.kind === "character" && Boolean(last.to.equipped);
  const heading = where && (equip ? `on ${where}` : `to ${where}`);
  const pending =
    notify ?? toast.loading(`${equip ? "Equipping" : "Moving"} ${main.name}`, heading);
  recent.set(main.key, Date.now());
  const now = Date.now();
  const queued = steps.map((step) => ({ ...step, id: nextId++ }));
  moveOps.set([
    ...moveOps.get(),
    ...queued.map((q) => ({ id: q.id, itemKey: q.item.key, to: q.to, status: "pending" as const, at: now })),
  ]);
  inFlight++;
  clearTimeout(refetchTimer);

  const run = queue.then(async (): Promise<MoveOutcome> => {
    for (const [i, step] of queued.entries()) {
      const isMain = step.item === main;
      if (pending && queued.length > 1) {
        pending.progress(
          `${equip ? "Equipping" : "Moving"} ${main.name}`,
          isMain ? heading : `Making room: ${step.item.name}`,
        );
      }
      const body = {
        itemId: step.item.instanceId ?? "0",
        itemHash: step.item.itemHash,
        stackSize: step.item.instanceId ? 1 : step.item.quantity,
        from: source(step.place),
        to: destination(step.to),
      };
      const sent = await send(step.id, body, ctx);
      if (!sent.ok) {
        // The moves after it counted on this one: drop them.
        const rest = new Set(queued.slice(i + 1).map((q) => q.id));
        if (rest.size > 0) moveOps.set(moveOps.get().filter((o) => !rest.has(o.id)));
        const title = isMain
          ? `Couldn't ${equip ? "equip" : "move"} ${main.name}`
          : `Couldn't make room for ${main.name}`;
        const message = isMain ? sent.message : `${step.item.name}: ${sent.message}`;
        if (pending) pending.error(title, message);
        return { ok: false, title, message };
      }
    }
    if (pending) pending.success(`${equip ? "Equipped" : "Moved"} ${main.name}`, heading);
    return { ok: true };
  });
  queue = run
    .then(() => undefined)
    .finally(() => {
      inFlight--;
      if (inFlight === 0) scheduleProfileRefetch(ctx);
    });
  return run;
}

/** Refetch the profile shortly, once a burst of actions (moves, locks) has gone quiet. */
export function scheduleProfileRefetch(ctx: MoveContext) {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => {
    void ctx.queryClient.refetchQueries({ queryKey: profileKey(ctx.membershipId) });
  }, REFETCH_DELAY_MS);
}

/** Send one move: ok when it went all the way, else why not. */
async function send(
  id: number,
  body: object,
  ctx: MoveContext,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/bungie/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Partial<MoveResult> & { error?: string; reauth?: boolean };

    if (!res.ok) {
      updateOp(id, null);
      if (data.reauth) void handleSessionExpired(ctx.queryClient);
      return { ok: false, message: data.error ?? "Move failed" };
    }
    if (data.ok) {
      updateOp(id, { status: "done", at: Date.now() });
      return { ok: true };
    }
    // Part of a hop went through (e.g. it reached the vault but the target was full):
    // show it where it actually is.
    if (data.landed) updateOp(id, { status: "done", to: data.landed, at: Date.now() });
    else updateOp(id, null);
    return { ok: false, message: data.error ?? "Move failed" };
  } catch {
    updateOp(id, null);
    return { ok: false, message: "Network error — check your connection" };
  }
}

function hasPending(key: string): boolean {
  return moveOps.get().some((o) => o.itemKey === key && o.status === "pending");
}

/** Whether a move of this item is still waiting on Bungie (re-renders only on change). */
export function useMovePending(key: string): boolean {
  return useSyncExternalStore(
    moveOps.subscribe,
    () => hasPending(key),
    () => false,
  );
}
