"use client";

// Locking and unlocking items from the manager: the new state shows at once (an op laid
// over the profile, like moves), requests go to Bungie one at a time, and a failure
// puts the old state back. One toast follows each request, spinner to outcome.
import { toast } from "@/lib/toast";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import { createValueStore } from "@/lib/value-store";
import type { InventoryItem, ManagerInventory } from "./build";
import { mapItems } from "./moves";
import { scheduleProfileRefetch, type MoveContext } from "./move-queue";

export interface LockOp {
  id: number;
  instanceId: string;
  locked: boolean;
  status: "pending" | "done";
  at: number;
}

export const lockOps = createValueStore<readonly LockOp[]>([]);
/** A finished op the profile still doesn't reflect is dropped after this. */
const LOCK_TTL_MS = 2 * 60_000;

let nextId = 1;
let queue: Promise<void> = Promise.resolve();
let inFlight = 0;

/** The inventory with each op's lock state applied (the latest op per item wins). */
export function applyLocks(inv: ManagerInventory, ops: readonly LockOp[]): ManagerInventory {
  if (ops.length === 0) return inv;
  const latest = new Map(ops.map((o) => [o.instanceId, o.locked]));
  return mapItems(inv, (item) => {
    const locked = item.instanceId ? latest.get(item.instanceId) : undefined;
    return locked === undefined || locked === item.locked ? item : { ...item, locked };
  });
}

/** Done ops the profile now shows (or too old to trust). */
export function settledLocks(base: ManagerInventory, ops: readonly LockOp[], now: number): Set<number> {
  const state = new Map<string, boolean>();
  mapItems(base, (item) => {
    if (item.instanceId) state.set(item.instanceId, item.locked);
    return item;
  });
  const out = new Set<number>();
  for (const op of ops) {
    if (op.status !== "done") continue;
    const current = state.get(op.instanceId);
    if (current === undefined || current === op.locked || now - op.at > LOCK_TTL_MS) out.add(op.id);
  }
  return out;
}

/** Lock (or unlock) each item that isn't already in that state, under one toast. */
export function requestLock(
  inventory: ManagerInventory,
  items: readonly InventoryItem[],
  locked: boolean,
  ctx: MoveContext,
): void {
  // Bungie wants a character with the request; any of the account's will do.
  const characterId = inventory.characters[0]?.id;
  if (!characterId) return;
  const todo = items.filter((item) => item.instanceId && item.locked !== locked);
  if (todo.length === 0) return;
  const verb = locked ? "lock" : "unlock";
  const what = todo.length === 1 ? todo[0]!.name : `${todo.length} items`;
  const pending = toast.loading(`${locked ? "Locking" : "Unlocking"} ${what}`);
  const sends = todo.map((item) => {
    const id = nextId++;
    const instanceId = item.instanceId!;
    lockOps.set([...lockOps.get(), { id, instanceId, locked, status: "pending", at: Date.now() }]);
    inFlight++;
    const sent = queue.then(() => send(id, { itemId: instanceId, characterId, locked }, ctx));
    queue = sent
      .then(() => undefined)
      .finally(() => {
        inFlight--;
        if (inFlight === 0) scheduleProfileRefetch(ctx);
      });
    return sent;
  });
  void Promise.all(sends).then((errors) => {
    const failed = errors.flatMap((error, i) => (error ? [{ item: todo[i]!, error }] : []));
    if (failed.length === 0) pending.success(`${locked ? "Locked" : "Unlocked"} ${what}`);
    else if (failed.length === todo.length) pending.error(`Couldn't ${verb} ${what}`, failed[0]!.error);
    else {
      pending.warning(
        `Couldn't ${verb} ${failed.length} of ${todo.length} items`,
        `${failed[0]!.item.name}: ${failed[0]!.error}`,
      );
    }
  });
}

function updateOp(id: number, patch: Partial<LockOp> | null) {
  lockOps.set(
    patch === null
      ? lockOps.get().filter((o) => o.id !== id)
      : lockOps.get().map((o) => (o.id === id ? { ...o, ...patch } : o)),
  );
}

/** Send one lock change; null when it went through, else why not. */
async function send(id: number, body: object, ctx: MoveContext): Promise<string | null> {
  try {
    const res = await fetch("/api/bungie/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; reauth?: boolean };
    if (res.ok && data.ok) {
      updateOp(id, { status: "done", at: Date.now() });
      return null;
    }
    updateOp(id, null);
    if (data.reauth) void handleSessionExpired(ctx.queryClient);
    return data.error ?? "Bungie refused";
  } catch {
    updateOp(id, null);
    return "Network error — check your connection";
  }
}
