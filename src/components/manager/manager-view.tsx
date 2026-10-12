"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import { requestLock } from "@/lib/inventory/lock-queue";
import { annotationsStore } from "@/lib/inventory/annotations";
import { recentlyMoved, requestMoves } from "@/lib/inventory/move-queue";
import { planSmartMove, type MoveStep, type SmartPlan } from "@/lib/inventory/smart-moves";
import { toast, type PendingToast } from "@/lib/toast";
import { loadViewSettings } from "@/lib/inventory/view-settings";
import {
  MOVABLE_BUCKETS,
  locate,
  type Landing,
  type Place,
} from "@/lib/inventory/moves";
import { CompareDrawer } from "./compare-drawer";
import { ItemDetails, type ItemDetailsTarget } from "./item-details";
import { FarmingBanner, FarmingRunner } from "./farming";
import { ManagerSearch } from "./manager-search";
import {
  ManagerActionsContext,
  ManagerLayoutContext,
  dragStore,
  type ManagerActions,
  type ManagerLayout,
} from "./manager-context";
import { phoneTileMetrics } from "@/lib/inventory/vault-layout";
import { usePhoneWidth, useTouchFirst } from "@/lib/use-min-width";
import { characterDropStore } from "./manager-drop-zone";
import { InventoryGrid } from "./manager-character-grid";
import { VaultPane } from "./manager-vault";

/**
 * Below this width, three character columns (about 930px) would leave the vault only a
 * handful of tiles across: show one character at a time, with tabs to switch.
 */
const ALL_CHARACTERS_MIN_PX = 1580;

/**
 * From this width the vault sits beside the characters, each of its slots on the same row
 * as that slot on the characters. Narrower, it goes below them in one list.
 */
const ALIGNED_MIN_PX = 760;

/** Phone tiles before the page is first measured (it is before the first paint). */
const UNMEASURED_PHONE_PX = 360;

/**
 * The inventory manager: one column per character on the left (postmaster, then
 * weapons, armor, and general gear, each row showing the equipped item beside the
 * rest of that slot), and the vault on the right, every vault slot level with that slot
 * on the characters. The page scrolls as one. Drag a tile onto a slot, a character's
 * nameplate, or the vault to move it; click it for its details and moves.
 */
export function ManagerView({
  inventory,
  membershipId,
}: {
  inventory: ManagerInventory;
  membershipId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const latest = useRef(inventory);
  useEffect(() => {
    latest.current = inventory;
  }, [inventory]);

  const [menu, setMenu] = useState<ItemDetailsTarget | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [aligned, setAligned] = useState(true);
  const [layoutWidth, setLayoutWidth] = useState(0);
  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const measure = () => {
      // Hidden along with its view (the router keeps recent views mounted): keep what it had.
      if (el.clientWidth === 0) return;
      setCompact(el.clientWidth < ALL_CHARACTERS_MIN_PX);
      setAligned(el.clientWidth >= ALIGNED_MIN_PX);
      setLayoutWidth(el.clientWidth);
    };
    // Now, before paint, so a phone's first frame already has its tile size.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Phones: tiles sized to fill the width, and the vault behind a tab of its own instead
  // of below every character slot.
  const phone = usePhoneWidth();
  const layout = useMemo<ManagerLayout>(
    () =>
      phone
        ? { phone, tiles: phoneTileMetrics(layoutWidth || UNMEASURED_PHONE_PX) }
        : { phone },
    [phone, layoutWidth],
  );
  // Touch can't drag a tile, so its details offer the moves as buttons.
  const touch = useTouchFirst();
  const [vaultOpen, setVaultOpen] = useState(false);
  /** The weapon (by name) whose copies are open in Compare. */
  const [comparing, setComparing] = useState<string | null>(null);
  useEffect(loadViewSettings, []);

  const actions = useMemo<ManagerActions>(() => {
    /** Queue a plan, naming where it goes in its toast. */
    const run = (steps: readonly MoveStep[], notify?: PendingToast | false) =>
      requestMoves(
        steps,
        { queryClient, membershipId },
        { where: landingName(latest.current, steps[steps.length - 1]?.to), notify },
      );
    return {
      inventory: () => latest.current,
      // Opening the item that's already open closes it.
      open: (item, anchor) =>
        setMenu((menu) => (menu?.key === item.key && menu.anchor === anchor ? null : { key: item.key, anchor })),
      dragStart: (item) => {
        const found = locate(latest.current, item.key);
        if (!found || !canDrag(found.item, found.place)) return false;
        setMenu(null);
        dragStore.set(found);
        return true;
      },
      dragEnd: () => {
        dragStore.set(null);
        characterDropStore.set(null);
      },
      problem: (item, place, to) => {
        const plan = smartPlan(latest.current, item, place, to);
        return plan.ok ? null : plan.problem;
      },
      move: (item, place, to) => {
        const plan = smartPlan(latest.current, item, place, to);
        if (!plan.ok) {
          toast.error(`Can't move ${item.name}`, plan.problem);
          return;
        }
        void run(plan.steps);
      },
      runSteps: (steps, notify) => run(steps, notify),
      quickEquip: (item) => {
        // Double-click: equip on the character played last (DIM's shortcut).
        setMenu(null);
        const found = locate(latest.current, item.key);
        const character = latest.current.characters[0];
        if (!found || !character) return;
        const { place } = found;
        if (place.kind === "character" && place.equipped && place.characterId === character.id) return;
        const to = { kind: "character", characterId: character.id, equipped: true } as const;
        const plan = smartPlan(latest.current, found.item, place, to);
        if (!plan.ok) {
          toast.error(`Can't equip ${item.name}`, plan.problem);
          return;
        }
        void run(plan.steps);
      },
      lock: (items, locked) =>
        requestLock(latest.current, items, locked, { queryClient, membershipId }),
      compare: (item) => {
        setMenu(null);
        setComparing(item.name);
      },
    };
  }, [queryClient, membershipId]);

  return (
    <ManagerActionsContext.Provider value={actions}>
      <FarmingRunner inventory={inventory} />
      <div className="flex flex-col gap-4">
        {/* Pinned over the page as it scrolls (the page's top padding counts toward a sticky
            offset, hence -top-6); filled once there's something under it. */}
        <div className="sticky -top-6 z-30 -mx-4 -mt-6 transition-colors group-data-scrolled/manager:bg-glass-opaque lg:-mx-6">
          <ManagerSearch inventory={inventory} />
        </div>
        <FarmingBanner inventory={inventory} />
        <ManagerLayoutContext value={layout}>
          <div ref={layoutRef} className="flex flex-col gap-6">
            <InventoryGrid
              inventory={inventory}
              compact={compact}
              aligned={aligned}
              vault={
                phone
                  ? {
                      open: vaultOpen,
                      onOpenChange: setVaultOpen,
                      pane: <VaultPane inventory={inventory} />,
                    }
                  : undefined
              }
            />
            {!aligned && !phone && <VaultPane inventory={inventory} />}
          </div>
        </ManagerLayoutContext>
      </div>
      <ItemDetails
        inventory={inventory}
        target={menu}
        onClose={() => setMenu(null)}
        onLock={(item, locked) => actions.lock([item], locked)}
        onCompare={actions.compare}
        sheet={phone}
        moves={phone || touch}
      />
      <CompareDrawer inventory={inventory} name={comparing} onClose={() => setComparing(null)} />
    </ManagerActionsContext.Provider>
  );
}

/** "your Warlock" or "the vault", for toasts. */
function landingName(inventory: ManagerInventory, to: Landing | undefined): string | undefined {
  if (!to) return undefined;
  if (to.kind === "vault") return "the vault";
  const character = inventory.characters.find((c) => c.id === to.characterId);
  return `your ${character ? (CLASS_NAMES[character.classType] ?? "Guardian") : "character"}`;
}

/** Account-wide and non-gear items don't drag (postmaster items always can). */
function canDrag(item: InventoryItem, place: Place): boolean {
  if (place.kind === "postmaster") return true;
  if (place.kind === "account") return false;
  return MOVABLE_BUCKETS.has(item.bucketHash) && Boolean(item.instanceId);
}

/** The moves that get `item` to `to`, making room on the way (see smart-moves.ts). */
function smartPlan(
  inventory: ManagerInventory,
  item: InventoryItem,
  place: Place,
  to: Landing,
): SmartPlan {
  return planSmartMove(inventory, item, place, to, {
    annotations: annotationsStore.get(),
    recent: recentlyMoved(),
  });
}
