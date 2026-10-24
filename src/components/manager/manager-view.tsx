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
import { cn } from "@/lib/utils";
import { loadViewSettings, useViewSettings } from "@/lib/inventory/view-settings";
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
import { desktopTileMetrics, phoneTileMetrics } from "@/lib/inventory/vault-layout";
import { itemsPagePlan, type ItemsPagePlan } from "@/lib/inventory/items-page-plan";
import { usePhoneWidth, useTouchFirst } from "@/lib/use-min-width";
import { characterDropStore } from "./manager-drop-zone";
import { CharacterRows } from "./character-rows";
import { InventoryGrid } from "./manager-character-grid";
import { VaultPane } from "./manager-vault";

/** Phone tiles before the page is first measured (it is before the first paint). */
const UNMEASURED_PHONE_PX = 360;

/**
 * The inventory manager: a row per character, laid out like the game's character screen
 * (see CharacterRows), and the vault beside them in a pane of its own that stays put as
 * the page scrolls, or below them when there's no room. Narrow screens show one character
 * at a time. The legacy layout (picked in the search bar's settings) has the characters
 * side by side in columns instead, the vault beside them level with their slots (see
 * itemsPagePlan). Drag a tile onto a slot, a character, or the vault to move it; click it
 * for its details and moves.
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
  const [layoutWidth, setLayoutWidth] = useState(0);
  // The saved layout, read before the first layout decision (the measure below) so a
  // legacy user never mounts the default layout first.
  useLayoutEffect(loadViewSettings, []);
  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const measure = () => {
      // Hidden along with its view (the router keeps recent views mounted): keep what it had.
      if (el.clientWidth === 0) return;
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
  const view = useViewSettings();
  // Only a phone's tiles follow the width: a desktop resize keeps the same layout object,
  // so tiles and vault lines don't re-render for it.
  const phoneWidth = phone ? layoutWidth || UNMEASURED_PHONE_PX : 0;
  const layout = useMemo<ManagerLayout>(
    () => ({
      phone,
      tiles: phone ? phoneTileMetrics(phoneWidth) : desktopTileMetrics(view.tileSize),
    }),
    [phone, phoneWidth, view.tileSize],
  );
  // Touch can't drag a tile, so its details offer the moves as buttons.
  const touch = useTouchFirst();
  const plan = itemsPagePlan({ phone, layout: view.layout, width: layoutWidth, tiles: layout.tiles });
  const [vaultOpen, setVaultOpen] = useState(false);
  /** The weapon (by name) whose copies are open in Compare. */
  const [comparing, setComparing] = useState<string | null>(null);

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
        <div className="sticky -top-6 z-30 -mx-4 -mt-6 transition-colors group-data-scrolled/manager:d2-sticky-fill lg:-mx-6">
          <ManagerSearch
            inventory={inventory}
            // Phones lay out the same either way, so the layout setting stays off them. Its
            // intro only opens over the character rows it introduces.
            layoutMenu={plan && plan.kind !== "phone" ? { intro: plan.kind === "rows" } : undefined}
          />
        </div>
        <FarmingBanner inventory={inventory} />
        <ManagerLayoutContext value={layout}>
          <div
            ref={layoutRef}
            className={cn(
              "flex gap-6",
              plan?.kind === "rows" && plan.vault === "beside" ? "items-start" : "flex-col",
            )}
          >
            {plan && (
              <PlannedLayout
                plan={plan}
                inventory={inventory}
                vaultTab={{ open: vaultOpen, onOpenChange: setVaultOpen }}
              />
            )}
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

/** The characters and the vault, as `plan` lays them out. */
function PlannedLayout({
  plan,
  inventory,
  vaultTab,
}: {
  plan: ItemsPagePlan;
  inventory: ManagerInventory;
  /** Phones: whether the Vault tab is picked. */
  vaultTab: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  switch (plan.kind) {
    case "rows":
      return (
        <>
          <CharacterRows inventory={inventory} />
          {plan.vault === "beside" ? (
            <VaultAside inventory={inventory} />
          ) : (
            <VaultPane inventory={inventory} placement="below-rows" />
          )}
        </>
      );
    case "columns":
      return (
        <>
          <InventoryGrid inventory={inventory} compact={plan.compact} aligned={plan.vault === "aligned"} />
          {plan.vault === "below" && <VaultPane inventory={inventory} placement="below-columns" />}
        </>
      );
    case "phone":
      return (
        <InventoryGrid
          inventory={inventory}
          compact
          aligned={false}
          vault={{ ...vaultTab, pane: <VaultPane inventory={inventory} placement="tab" /> }}
        />
      );
  }
}

/**
 * The vault beside the characters: pinned under the search bar and scrolled on its own, so
 * any vault item can be dragged to any character in view. Its header pins to the pane's
 * top, filled once tiles scroll under it.
 */
function VaultAside({ inventory }: { inventory: ManagerInventory }) {
  return (
    <aside
      className="group/vault d2-scroll sticky top-8 max-h-[calc(100dvh-5rem)] min-w-0 flex-1 overflow-y-auto overscroll-contain"
      onScroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)}
    >
      <VaultPane inventory={inventory} placement="beside-rows" />
    </aside>
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
