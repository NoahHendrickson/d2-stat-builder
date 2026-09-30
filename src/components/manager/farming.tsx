"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlantIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { profileKey } from "@/lib/armory/keys";
import { annotationsStore } from "@/lib/inventory/annotations";
import type { ManagerInventory } from "@/lib/inventory/build";
import { farmingPlans } from "@/lib/inventory/farming";
import { moveOps, recentlyMoved } from "@/lib/inventory/move-queue";
import { characterName } from "@/lib/inventory/moves";
import { createValueStore, useStoreValue } from "@/lib/value-store";
import { useManagerActions } from "./manager-context";

/** The character being farmed on, or null. Lasts for the session (not saved). */
export const farmingStore = createValueStore<string | null>(null);

/** How often farming mode refreshes the profile to spot new drops. */
const REFRESH_MS = 30_000;

/**
 * Runs farming mode: refreshes the profile every 30 seconds while the tab is visible,
 * and after each refresh sends the least wanted items to the vault so every gear slot
 * on the farmed character has room for a drop.
 */
export function FarmingRunner({
  inventory,
  membershipId,
}: {
  inventory: ManagerInventory;
  membershipId: string | undefined;
}) {
  const characterId = useStoreValue(farmingStore);
  const actions = useManagerActions();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!characterId) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void queryClient.refetchQueries({ queryKey: profileKey(membershipId) });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [characterId, membershipId, queryClient]);

  useEffect(() => {
    if (!characterId || !actions) return;
    if (!inventory.characters.some((c) => c.id === characterId)) {
      farmingStore.set(null);
      return;
    }
    // Wait for moves in flight; the next inventory will show where they landed.
    if (moveOps.get().some((o) => o.status === "pending")) return;
    const plans = farmingPlans(inventory, characterId, {
      annotations: annotationsStore.get(),
      recent: recentlyMoved(),
    });
    for (const steps of plans) void actions.runSteps(steps);
  }, [inventory, characterId, actions]);

  return null;
}

export function FarmingBanner({ inventory }: { inventory: ManagerInventory }) {
  const characterId = useStoreValue(farmingStore);
  const character = inventory.characters.find((c) => c.id === characterId);
  if (!character) return null;
  return (
    <div
      role="status"
      className="bg-foreground/10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
    >
      <HugeiconsIcon icon={PlantIcon} className="size-4 shrink-0" aria-hidden />
      <span className="font-medium">Farming on your {characterName(character)}</span>
      <span className="text-muted-foreground">
        Every 30 seconds, extras go to the vault so each gear slot keeps room for a drop.
      </span>
      <Button variant="default" size="sm" className="ml-auto" onClick={() => farmingStore.set(null)}>
        Stop
      </Button>
    </div>
  );
}
