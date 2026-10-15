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
import { TILE_GAP_PX, TILE_WIDTH_PX, phoneTileMetrics } from "@/lib/inventory/vault-layout";
import { usePhoneWidth, useTouchFirst } from "@/lib/use-min-width";
import { characterDropStore } from "./manager-drop-zone";
import { CHARACTER_ROW_PX, CharacterRows } from "./character-rows";
import { InventoryGrid } from "./manager-character-grid";
import { VaultPane } from "./manager-vault";

/** Between the characters and the vault beside them (gap-6). */
const LAYOUT_GAP_PX = 24;
/** The vault goes beside the characters only with room for five tiles across. */
const VAULT_BESIDE_MIN_PX = 5 * TILE_WIDTH_PX + 4 * TILE_GAP_PX;

/**
 * How the characters' rows fit `width`: with the vault beside them when there's room for
 * it, else below. Null when a row doesn't fit at all: then it's one character at a time.
 */
function rowsLayout(width: number): { vaultBeside: boolean } | null {
  if (CHARACTER_ROW_PX + LAYOUT_GAP_PX + VAULT_BESIDE_MIN_PX <= width) return { vaultBeside: true };
  return CHARACTER_ROW_PX <= width ? { vaultBeside: false } : null;
}

/**
 * The legacy layout: below this width, three character columns (about 930px) would leave
 * the vault only a handful of tiles across, so it shows one character at a time.
 */
const LEGACY_ALL_CHARACTERS_MIN_PX = 1580;

/**
 * The legacy layout: from this width the vault sits beside the characters, each of its
 * slots on the same row as that slot on the characters. Narrower, it goes below them.
 */
const LEGACY_ALIGNED_MIN_PX = 760;

/** Phone tiles before the page is first measured (it is before the first paint). */
const UNMEASURED_PHONE_PX = 360;

/**
 * The inventory manager: a row per character, laid out like the game's character screen
 * (see CharacterRows), and the vault beside them in a pane of its own that stays put as
 * the page scrolls, or below them when there's no room. Narrow screens show one character
 * at a time. The legacy layout (picked in the search bar's settings) has the characters
 * side by side in columns instead, the vault beside them level with their slots. Drag a
 * tile onto a slot, a character, or the vault to move it; click it for its details and
 * moves.
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
  const layout = useMemo<ManagerLayout>(
    () =>
      phone
        ? { phone, tiles: phoneTileMetrics(layoutWidth || UNMEASURED_PHONE_PX) }
        : { phone },
    [phone, layoutWidth],
  );
  // Touch can't drag a tile, so its details offer the moves as buttons.
  const touch = useTouchFirst();
  const legacy = useViewSettings().layout === "legacy";
  const rows = phone || legacy || layoutWidth === 0 ? null : rowsLayout(layoutWidth);
  // Phones lay out the same either way: one character at a time, the vault a tab.
  const legacyColumns = legacy && !phone;
  const legacyAligned = legacyColumns && layoutWidth >= LEGACY_ALIGNED_MIN_PX;
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
        <div className="sticky -top-6 z-30 -mx-4 -mt-6 transition-colors group-data-scrolled/manager:d2-sticky-fill lg:-mx-6">
          <ManagerSearch inventory={inventory} />
        </div>
        <FarmingBanner inventory={inventory} />
        <ManagerLayoutContext value={layout}>
          <div
            ref={layoutRef}
            className={cn("flex gap-6", rows?.vaultBeside ? "items-start" : "flex-col")}
          >
            {rows ? (
              <CharacterRows inventory={inventory} />
            ) : (
              <InventoryGrid
                inventory={inventory}
                compact={!legacyColumns || layoutWidth < LEGACY_ALL_CHARACTERS_MIN_PX}
                aligned={legacyAligned}
                legacy={legacyColumns}
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
            )}
            {rows?.vaultBeside ? (
              <VaultAside inventory={inventory} />
            ) : (
              !phone &&
              !legacyAligned && (
                <VaultPane
                  inventory={inventory}
                  tall={rows !== null}
                  // Across the page's whole width, gutters too, like the search bar it
                  // pins under: a fill only as wide as the vault left tiles showing either side.
                  headerClassName="sticky top-8 z-10 -mx-4 -mt-3 px-4 py-3 group-data-scrolled/manager:d2-sticky-fill lg:-mx-6 lg:px-6"
                />
              )
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
      <VaultPane
        inventory={inventory}
        tall
        headerClassName="sticky top-0 z-10 pb-3 group-data-scrolled/vault:d2-sticky-fill"
      />
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
