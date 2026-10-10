"use client";

import { annotationsStore } from "@/lib/inventory/annotations";
import type { InventoryItem } from "@/lib/inventory/build";
import { applyMoves, locate, type Landing, type Place } from "@/lib/inventory/moves";
import { recentlyMoved, type MoveOutcome } from "@/lib/inventory/move-queue";
import { planSmartMove } from "@/lib/inventory/smart-moves";
import { toast } from "@/lib/toast";
import type { ManagerActions } from "./manager-context";

const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`;

/** Already on that character (equipped or not) or in the vault. */
function isThere(at: Place, to: Landing): boolean {
  return to.kind === "vault"
    ? at.kind === "vault"
    : at.kind === "character" && at.characterId === to.characterId;
}

/**
 * Move each item that can go, making room as needed: a full slot on the target sends
 * its least wanted item to the vault. Each plan is made against the moves already
 * planned, and never moves an earlier item back out to make room. One toast for the
 * batch.
 */
export function moveAll(actions: ManagerActions, items: readonly InventoryItem[], to: Landing): void {
  let sim = actions.inventory();
  const placed = new Set<string>();
  const runs: Promise<MoveOutcome>[] = [];
  let skipped = 0;
  for (const item of items) {
    const at = locate(sim, item.key)?.place;
    if (!at || isThere(at, to)) {
      placed.add(item.key);
      continue;
    }
    const plan = planSmartMove(sim, item, at, to, {
      annotations: annotationsStore.get(),
      recent: recentlyMoved(),
      pinned: placed,
    });
    if (!plan.ok) {
      skipped++;
      continue;
    }
    runs.push(actions.runSteps(plan.steps, false));
    sim = applyMoves(
      sim,
      plan.steps.map((s) => ({ id: -1, itemKey: s.item.key, to: s.to, status: "pending" as const, at: 0 })),
    );
    placed.add(item.key);
  }
  const noRoom = "No room could be made, or they can't go there";
  if (runs.length === 0) {
    if (skipped === 0) toast.info("Everything is already there");
    else toast.error(`Couldn't move ${plural(skipped)}`, noRoom);
    return;
  }
  // A spinner until every move is done, then the tally.
  const pending = toast.loading(`Moving ${plural(runs.length)}`);
  void Promise.all(runs).then((outcomes) => {
    const failed = outcomes.filter((o) => !o.ok);
    const why = failed[0] && !failed[0].ok ? failed[0].message : noRoom;
    const moved = outcomes.length - failed.length;
    if (moved === 0) pending.error(`Couldn't move ${plural(failed.length + skipped)}`, why);
    else if (failed.length + skipped === 0) pending.success(`Moved ${plural(moved)}`);
    else pending.warning(`Moved ${moved} of ${plural(outcomes.length + skipped)}`, why);
  });
}
