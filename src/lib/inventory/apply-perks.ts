"use client";

// "Apply perks" from the manager's item panel: swap a weapon's perks to other options it
// rolled with (InsertSocketPlugFree via POST /api/bungie/plugs), then refresh the
// profile so the panel shows the new roll.
import { handleSessionExpired } from "@/lib/auth/sign-out";
import type { PlugResult } from "@/lib/bungie/equip-server";
import { toast } from "@/lib/toast";
import type { InventoryItem } from "./build";
import { scheduleProfileRefetch, type MoveContext } from "./move-queue";

export interface PerkChange {
  socketIndex: number;
  plugItemHash: number;
}

/** Resolves true when every perk went in. */
export async function applyPerks(
  item: InventoryItem,
  characterId: string,
  plugs: readonly PerkChange[],
  ctx: MoveContext,
): Promise<boolean> {
  if (!item.instanceId || plugs.length === 0) return false;
  const pending = toast.loading(`Changing perks on ${item.name}`);
  try {
    const res = await fetch("/api/bungie/plugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.instanceId, characterId, plugs }),
    });
    const data = (await res.json()) as { plugs?: PlugResult[]; error?: string; reauth?: boolean };
    if (!res.ok || !data.plugs) {
      pending.error(`Couldn't change ${item.name}'s perks`, data.error ?? "Bungie refused");
      if (data.reauth) void handleSessionExpired(ctx.queryClient);
      return false;
    }
    scheduleProfileRefetch(ctx);
    const failed = data.plugs.filter((p) => !p.ok);
    if (failed.length === 0) {
      pending.success(`Perks changed on ${item.name}`);
      return true;
    }
    pending.error(
      failed.length === data.plugs.length
        ? `Couldn't change ${item.name}'s perks`
        : `Some perks didn't change on ${item.name}`,
      failed[0]?.message ?? "Bungie refused",
    );
    return false;
  } catch {
    pending.error(`Couldn't change ${item.name}'s perks`, "Network error — check your connection");
    return false;
  }
}
