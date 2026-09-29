"use client";

// Locking and unlocking items from the manager: the new state shows at once (an op laid
// over the profile, like moves), requests go to Bungie one at a time, and a failure
// puts the old state back with a toast.
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

/** Lock (or unlock) each item that isn't already in that state. */
export function requestLock(
  inventory: ManagerInventory,
  items: readonly InventoryItem[],
  locked: boolean,
  ctx: MoveContext,
): void {
  // Bungie wants a character with the request; any of the account's will do.
  const characterId = inventory.characters[0]?.id;
  if (!characterId) return;
  for (const item of items) {
    if (!item.instanceId || item.locked === locked) continue;
    const id = nextId++;
    const instanceId = item.instanceId;
    lockOps.set([...lockOps.get(), { id, instanceId, locked, status: "pending", at: Date.now() }]);
    inFlight++;
    queue = queue
      .then(() => send(id, item, { itemId: instanceId, characterId, locked }, ctx))
      .finally(() => {
        inFlight--;
        if (inFlight === 0) scheduleProfileRefetch(ctx);
      });
  }
}

function updateOp(id: number, patch: Partial<LockOp> | null) {
  lockOps.set(
    patch === null
      ? lockOps.get().filter((o) => o.id !== id)
      : lockOps.get().map((o) => (o.id === id ? { ...o, ...patch } : o)),
  );
}

async function send(id: number, item: InventoryItem, body: object, ctx: MoveContext) {
  const verb = (body as { locked: boolean }).locked ? "lock" : "unlock";
  try {
    const res = await fetch("/api/bungie/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; reauth?: boolean };
    if (res.ok && data.ok) {
      updateOp(id, { status: "done", at: Date.now() });
      return;
    }
    updateOp(id, null);
    toast.error(`Couldn't ${verb} ${item.name}`, data.error ?? "Bungie refused");
    if (data.reauth) void handleSessionExpired(ctx.queryClient);
  } catch {
    updateOp(id, null);
    toast.error(`Couldn't ${verb} ${item.name}`, "Network error — check your connection");
  }
}
