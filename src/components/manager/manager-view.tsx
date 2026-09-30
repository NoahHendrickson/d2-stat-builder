"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlantIcon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { ClassGlyph } from "@/components/class-glyph";
import { PowerValue } from "@/components/power-value";
import { StatGlyph } from "@/components/stat-glyph";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  type StatIconMap,
} from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  ACCOUNT_ROWS,
  CHARACTER_GROUPS,
  VAULT_GROUPS,
  type BucketRow,
} from "@/lib/inventory/buckets";
import {
  OTHER_BUCKET,
  type InventoryItem,
  type ManagerCharacter,
  type ManagerInventory,
} from "@/lib/inventory/build";
import { requestLock } from "@/lib/inventory/lock-queue";
import { annotationsStore } from "@/lib/inventory/annotations";
import { recentlyMoved, requestMoves } from "@/lib/inventory/move-queue";
import { planSmartMove, type MoveStep, type SmartPlan } from "@/lib/inventory/smart-moves";
import { toast, type PendingToast } from "@/lib/toast";
import {
  groupItems,
  loadViewSettings,
  setViewSettings,
  useViewSettings,
  VAULT_TAB_LABELS,
  VAULT_TABS,
  type GroupKey,
  type VaultTab,
} from "@/lib/inventory/view-settings";
import { statIconsFromManifest } from "@/lib/manifest/stat-icons";
import { useManifest } from "@/lib/manifest/use-manifest";
import {
  CHARACTER_SLOTS,
  MOVABLE_BUCKETS,
  locate,
  type Landing,
  type Place,
} from "@/lib/inventory/moves";
import { cn } from "@/lib/utils";
import { weaponTypeIcon } from "@/lib/weapons/weapon-type-icon-paths";
import { createValueStore, useStoreValue } from "@/lib/value-store";
import { EmptyTile, ItemTile } from "./item-tile";
import { CompareDrawer } from "./compare-drawer";
import { ItemDetails, type ItemDetailsTarget } from "./item-details";
import { FarmingBanner, FarmingRunner, farmingStore } from "./farming";
import { ManagerSearch } from "./manager-search";
import { useItemComparator } from "./view-menu";
import {
  ManagerActionsContext,
  dragStore,
  useManagerActions,
  type DragInfo,
  type ManagerActions,
} from "./manager-context";

const POSTMASTER_FALLBACK_CAPACITY = 21;

/**
 * The inventory manager: one column per character on the left (postmaster, then
 * weapons, armor, and general gear, each row showing the equipped item beside the
 * rest of that slot), and the vault on the right. Drag a tile onto a slot, a
 * character's nameplate, or the vault to move it; click it for its details and moves.
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
      open: (item, anchor) => setMenu({ key: item.key, anchor }),
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
      <FarmingRunner inventory={inventory} membershipId={membershipId} />
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <ManagerSearch inventory={inventory} />
        <FarmingBanner inventory={inventory} />
        <div className="flex min-h-0 flex-1 flex-col gap-6 xl:flex-row">
          <CharacterGrid inventory={inventory} />
          <VaultPane inventory={inventory} />
        </div>
      </div>
      <ItemDetails
        inventory={inventory}
        target={menu}
        onClose={() => setMenu(null)}
        onLock={(item, locked) => actions.lock([item], locked)}
        onCompare={actions.compare}
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

/**
 * The character whose column a drop would go through (the pointer is on its column but
 * not on a slot that takes the item): the item's slot row there lights up as the landing.
 */
const characterDropStore = createValueStore<string | null>(null);

/**
 * Whether the dragged item can land at `to`, planned once per drag and landing: every
 * slot row of a character is a zone for the same landing, and they all re-render as the
 * lit character changes.
 */
const acceptCache = new WeakMap<DragInfo, Map<string, boolean>>();
function canLand(actions: ManagerActions, drag: DragInfo, to: Landing): boolean {
  const key = to.kind === "vault" ? "vault" : `${to.characterId}:${to.equipped ? "e" : ""}`;
  let byLanding = acceptCache.get(drag);
  if (!byLanding) acceptCache.set(drag, (byLanding = new Map()));
  let ok = byLanding.get(key);
  if (ok === undefined) {
    ok = actions.problem(drag.item, drag.place, to) === null;
    byLanding.set(key, ok);
  }
  return ok;
}

/**
 * A place an item can be dropped. While a drag is on, zones the item could go to get a
 * faint fill and the one under the pointer a stronger one; the rest stay as they are.
 * Zones nest: a slot row that takes the item handles the drop, otherwise it falls
 * through to the character's column around it.
 */
function DropZone({
  to,
  bucket,
  column = false,
  label,
  className,
  style,
  children,
}: {
  to: Landing;
  /** Only items of this bucket (a slot row); omit to take any movable item. */
  bucket?: number;
  /** A character's whole column: tinted over its content, only while under the pointer. */
  column?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const actions = useManagerActions();
  const drag = useStoreValue(dragStore);
  const dropCharacter = useStoreValue(characterDropStore);
  const [over, setOver] = useState(false);
  const accepts =
    drag !== null &&
    actions !== null &&
    (bucket === undefined || drag.item.bucketHash === bucket) &&
    canLand(actions, drag, to);
  const inventoryOf = to.kind === "character" && !to.equipped ? to.characterId : undefined;
  // The item's own slot row on the character whose column it's being dropped on.
  const landing = accepts && bucket !== undefined && inventoryOf === dropCharacter;

  const tint = !accepts
    ? undefined
    : column
      ? over && "bg-foreground/10"
      : over || landing
        ? "bg-foreground/15"
        : "bg-foreground/5";
  return (
    <div
      aria-label={label}
      className={cn("transition-colors duration-100", column ? "relative" : tint, className)}
      style={style}
      onDragOver={(e) => {
        if (!accepts) return;
        setOver(true);
        // A slot row inside already took it: the column only shows it's the target.
        const direct = e.defaultPrevented;
        if (column) characterDropStore.set(direct ? null : (inventoryOf ?? null));
        if (direct) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        if (column && characterDropStore.get() === inventoryOf) characterDropStore.set(null);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!accepts || !actions || e.defaultPrevented) return;
        e.preventDefault();
        actions.move(drag.item, drag.place, to);
        actions.dragEnd();
      }}
    >
      {children}
      {column && tint && (
        <span aria-hidden className={cn("pointer-events-none absolute inset-0 z-20", tint)} />
      )}
    </div>
  );
}

function CharacterGrid({ inventory }: { inventory: ManagerInventory }) {
  const { characters } = inventory;
  const postmasterCapacity = inventory.postmasterCapacity ?? POSTMASTER_FALLBACK_CAPACITY;
  const columns = { gridTemplateColumns: `repeat(${characters.length}, max-content)` };
  // Nameplate, postmaster, then every slot row: each column spans them all on a subgrid,
  // so rows still line up across characters.
  const rowCount = 2 + CHARACTER_GROUPS.reduce((n, group) => n + group.rows.length, 0);
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const statIcons = useMemo(() => statIconsFromManifest(manifest), [manifest]);
  const compare = useItemComparator();

  return (
    <section
      aria-label="Characters"
      className="d2-scroll group/grid shrink-0 overflow-x-auto xl:min-h-0 xl:overflow-y-auto"
      // The pinned nameplates only need a fill once rows scroll under them; at rest the
      // pane shows through. Set directly so scrolling never re-renders the grid.
      onScroll={(e) =>
        e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)
      }
    >
      <div className="grid" style={columns}>
        {characters.map((c) => (
          // The whole column is one target (padding splits the gap between columns), so a
          // drop anywhere on a character sends the item there.
          <DropZone
            key={c.id}
            to={{ kind: "character", characterId: c.id }}
            column
            label={CLASS_NAMES[c.classType] ?? "Guardian"}
            className="grid grid-rows-subgrid px-3 first:pl-0 last:pr-0"
            style={{ gridRow: `span ${rowCount}` }}
          >
            <CharacterHeader character={c} statIcons={statIcons} />
            <PostmasterCell items={c.postmaster} capacity={postmasterCapacity} />
            {/* Weapons, armor, general: no headings, just a wider gap before each group. */}
            {CHARACTER_GROUPS.map((group) =>
              group.rows.map((row, i) => (
                <CharacterCell
                  key={row.hash}
                  character={c}
                  row={row}
                  groupStart={i === 0}
                  compare={compare}
                />
              )),
            )}
          </DropZone>
        ))}
      </div>
    </section>
  );
}

function GroupHeading({ children }: { children: string }) {
  return <h2 className="d2-label pt-5 pb-1">{children}</h2>;
}

/**
 * The character's emblem nameplate with class and Power, pinned while the grid scrolls.
 * Dropping on it sends the item to that character (and pulls postmaster items).
 */
function CharacterHeader({
  character,
  statIcons,
}: {
  character: ManagerCharacter;
  statIcons: StatIconMap;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const farming = useStoreValue(farmingStore) === character.id;
  const name = CLASS_NAMES[character.classType] ?? "Guardian";
  const fallbackColor = character.emblemColor
    ? `rgb(${character.emblemColor.red} ${character.emblemColor.green} ${character.emblemColor.blue})`
    : undefined;

  return (
    <div className="group-data-scrolled/grid:bg-glass-opaque sticky top-0 z-10 pb-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${name} options`}
                className="relative block h-12 w-full overflow-hidden border border-foreground/15 text-left outline-none focus-visible:d2-tile-selected"
              />
            }
          >
            {character.emblemBackgroundPath && !imgFailed ? (
              <Image
                src={`${BUNGIE_IMAGE_BASE}${character.emblemBackgroundPath}`}
                alt=""
                fill
                sizes="240px"
                className="object-cover object-left"
                onError={() => setImgFailed(true)}
                unoptimized
              />
            ) : (
              <div
                className="bg-muted absolute inset-0"
                style={fallbackColor ? { backgroundColor: fallbackColor } : undefined}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-black/45 to-black/75" />
            <div className="absolute inset-y-0 right-0 flex flex-col items-end justify-center gap-0.5 px-2.5 text-right">
              <span className="d2-heading text-xs leading-none text-white drop-shadow">{name}</span>
              <PowerValue value={character.light} size="xs" className="drop-shadow" />
              {character.maxPower !== undefined && (
                <span
                  className="text-[10px] leading-none text-white/75 tabular-nums drop-shadow"
                  title="The highest gear power this character could equip from your whole account"
                >
                  Max {character.maxPower}
                </span>
              )}
            </div>
            {farming && (
              <HugeiconsIcon
                icon={PlantIcon}
                className="absolute top-1.5 left-1.5 size-4 text-white drop-shadow"
                aria-label="Farming"
              />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem
              className="h-auto items-start py-1.5"
              onClick={() => farmingStore.set(farming ? null : character.id)}
            >
              <HugeiconsIcon icon={PlantIcon} className="mt-0.5" aria-hidden />
              <span className="flex flex-col">
                {farming ? "Stop farming mode" : "Farming mode"}
                <span className="text-muted-foreground text-xs">
                  Keep a slot free in each gear slot by sending extras to the vault
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      <CharacterStats stats={character.stats} icons={statIcons} />
    </div>
  );
}

/** The character's six armor stat totals, in the game's order. */
function CharacterStats({
  stats,
  icons,
}: {
  stats: ManagerCharacter["stats"];
  icons: StatIconMap;
}) {
  if (Object.keys(stats).length === 0) return null;
  return (
    <dl className="flex justify-between pt-1.5 text-xs">
      {STAT_DISPLAY_ORDER.map((key) => (
        <div key={key} className="flex items-center gap-0.5">
          <dt>
            <StatGlyph src={icons[key]} label={STAT_LABELS[key]} className="size-3.5" />
          </dt>
          <dd className="tabular-nums">{stats[key] ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One slot for one character: the equipped item (drop here to equip), then a 3×3 grid
 * of the rest (drop here to send it to this character).
 */
function CharacterCell({
  character,
  row,
  groupStart,
  compare,
}: {
  character: ManagerCharacter;
  row: BucketRow;
  /** First row of weapons / armor / general: set apart from the group above. */
  groupStart: boolean;
  compare: (a: InventoryItem, b: InventoryItem) => number;
}) {
  const equipped = character.equipped[row.hash];
  const unsorted = character.inventory[row.hash];
  const items = useMemo(() => [...(unsorted ?? [])].sort(compare), [unsorted, compare]);
  const empty = Math.max(0, CHARACTER_SLOTS - items.length);

  return (
    <div className={cn("flex gap-2 pb-2", groupStart && "pt-5")} aria-label={row.label}>
      <DropZone
        to={{ kind: "character", characterId: character.id, equipped: true }}
        bucket={row.hash}
        className="self-start p-1"
      >
        {equipped ? <ItemTile item={equipped} /> : <EmptyTile />}
      </DropZone>
      <DropZone
        to={{ kind: "character", characterId: character.id }}
        bucket={row.hash}
        className="grid grid-cols-[repeat(3,56px)] content-start gap-1.5 p-1"
      >
        {items.map((item) => (
          <ItemTile key={item.key} item={item} />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <EmptyTile key={i} />
        ))}
      </DropZone>
    </div>
  );
}

function PostmasterCell({ items, capacity }: { items: InventoryItem[]; capacity: number }) {
  // The game warns once the postmaster is close to overflowing (and losing items).
  const nearlyFull = items.length >= capacity - 3;
  return (
    <div className="pt-2">
      <div className="d2-card-frame flex flex-col gap-2 p-2">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <h3 className="d2-label">Postmaster</h3>
          <span
            className={cn(
              "tabular-nums",
              nearlyFull ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {items.length === 0 ? "Empty" : `${items.length} / ${capacity}`}
          </span>
        </div>
        {items.length > 0 && (
          <div className="grid grid-cols-[repeat(5,44px)] gap-1.5">
            {items.map((item) => (
              <ItemTile key={item.key} item={item} size={44} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The vault; the whole pane is one drop target. */
function VaultPane({ inventory }: { inventory: ManagerInventory }) {
  const { vault, account } = inventory;
  const other = vault[OTHER_BUCKET] ?? [];
  const view = useViewSettings();
  const { weaponGroup, armorGroup, vaultTab } = view;
  // The Weapons and Armor tabs show just that section; All shows every one.
  const groups =
    vaultTab === "all" ? VAULT_GROUPS : VAULT_GROUPS.filter((g) => g.label === VAULT_TAB_LABELS[vaultTab]);
  // Weapons and armor each follow their own grouping; the rest isn't grouped.
  const groupFor = (label: string): GroupKey =>
    label === "Weapons" ? weaponGroup : label === "Armor" ? armorGroup : "none";

  return (
    <DropZone to={{ kind: "vault" }} className="flex min-w-0 flex-1 flex-col xl:min-h-0">
      <section aria-label="Vault" className="flex flex-1 flex-col xl:min-h-0">
        <Tabs
          value={vaultTab}
          onValueChange={(tab) => setViewSettings({ ...view, vaultTab: tab as VaultTab })}
          className="pb-3"
        >
          <TabsList variant="line" aria-label="Vault sections" className="w-full justify-start">
            {VAULT_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="flex-none">
                {VAULT_TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <VaultHeader inventory={inventory} />
        <div className="d2-scroll flex flex-col pb-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          {groups.map((group) => (
            <Fragment key={group.label}>
              <GroupHeading>{group.label}</GroupHeading>
              {group.rows.map((row) => (
                <VaultRow
                  key={row.hash}
                  label={row.label}
                  items={vault[row.hash] ?? []}
                  groupBy={groupFor(group.label)}
                />
              ))}
            </Fragment>
          ))}
          {vaultTab === "all" && (
            <>
              {other.length > 0 && (
                <>
                  <GroupHeading>Other</GroupHeading>
                  <VaultRow items={other} groupBy="none" />
                </>
              )}
              <GroupHeading>Account</GroupHeading>
              {ACCOUNT_ROWS.map((row) => (
                <VaultRow key={row.hash} label={row.label} items={account[row.hash] ?? []} groupBy="none" />
              ))}
            </>
          )}
        </div>
      </section>
    </DropZone>
  );
}

/**
 * Vault space (total, and per kind of item), the account-wide inventories' space, and
 * the account's currencies.
 */
function VaultHeader({ inventory }: { inventory: ManagerInventory }) {
  const { vault, account, vaultCount, vaultCapacity, accountCapacity, currencies } = inventory;
  const counts = [
    ...VAULT_GROUPS.map((group) => ({
      label: group.label,
      count: group.rows.reduce((n, row) => n + (vault[row.hash]?.length ?? 0), 0),
      capacity: undefined as number | undefined,
    })),
    ...((vault[OTHER_BUCKET]?.length ?? 0) > 0
      ? [{ label: "Other", count: vault[OTHER_BUCKET]?.length ?? 0, capacity: undefined }]
      : []),
    ...ACCOUNT_ROWS.map((row) => ({
      label: row.label,
      count: account[row.hash]?.length ?? 0,
      capacity: accountCapacity[row.hash],
    })),
  ];
  const full = vaultCapacity !== undefined && vaultCount >= vaultCapacity;
  const fill = vaultCapacity ? Math.min(100, (vaultCount / vaultCapacity) * 100) : undefined;

  return (
    <header className="flex flex-col gap-2 pb-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="d2-heading text-sm">Vault</h2>
        <span className={cn("text-xs tabular-nums", full ? "text-destructive" : "text-muted-foreground")}>
          {vaultCount.toLocaleString()}
          {vaultCapacity ? ` / ${vaultCapacity.toLocaleString()}` : ""}
        </span>
      </div>
      {fill !== undefined && (
        <div aria-hidden className="bg-foreground/10 h-1">
          <div className={cn("h-full", full ? "bg-destructive" : "bg-foreground/60")} style={{ width: `${fill}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {counts.map(({ label, count, capacity }) => (
          <span key={label} className="text-muted-foreground">
            {label}{" "}
            <span
              className={cn(
                "text-foreground tabular-nums",
                capacity !== undefined && count >= capacity && "text-destructive",
              )}
            >
              {count}
              {capacity !== undefined ? ` / ${capacity}` : ""}
            </span>
          </span>
        ))}
      </div>
      {currencies.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Currencies">
          {currencies.map((c) => (
            <span key={c.itemHash} className="flex items-center gap-1.5" title={c.name}>
              {c.icon && (
                <Image
                  src={`${BUNGIE_IMAGE_BASE}${c.icon}`}
                  alt={c.name}
                  width={16}
                  height={16}
                  className="size-4"
                  unoptimized
                />
              )}
              <span className="tabular-nums">{c.quantity.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

/** One vault row, sorted by the view settings and split into groups. */
function VaultRow({ label, items, groupBy }: { label?: string; items: InventoryItem[]; groupBy: GroupKey }) {
  const compare = useItemComparator();
  const groups = useMemo(
    () => groupItems([...items].sort(compare), groupBy),
    [items, compare, groupBy],
  );
  if (items.length === 0) return null;
  // No text labels: groups sit side by side, except types, which get a line each.
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex items-start py-2.5 [content-visibility:auto]",
        groupBy === "type" ? "flex-col gap-4" : "flex-wrap gap-x-5 gap-y-4",
      )}
    >
      {groups.map((group) => (
        <div key={group.key} className="flex max-w-full items-start gap-3">
          <GroupMarker groupBy={groupBy} item={group.items[0]!} />
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item) => (
              <ItemTile key={item.key} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What a vault group is, as a picture beside its tiles: the weapon type's silhouette
 * or the class sigil. Nothing for other groupings, armor types, or any-class items.
 */
function GroupMarker({ groupBy, item }: { groupBy: GroupKey; item: InventoryItem }) {
  if (groupBy === "class") {
    // Centred on the tile's icon (56px), above its footer bar.
    return item.classType === 3 ? null : (
      <span className="flex h-14 shrink-0 items-center">
        <ClassGlyph classType={item.classType} className="text-muted-foreground h-8 w-auto" />
      </span>
    );
  }
  // Only weapons have an ammo type; a type without a silhouette keeps its column.
  if (groupBy !== "type" || item.ammoType === undefined) return null;
  const icon = weaponTypeIcon(item.typeName, item.ammoType);
  const mask = icon && `url("${icon}") left center / contain no-repeat`;
  return (
    <span className="flex h-14 w-14 shrink-0 items-center">
      {mask && (
        <span
          role="img"
          aria-label={item.typeName}
          title={item.typeName}
          className="bg-muted-foreground h-5 w-full"
          style={{ mask, WebkitMask: mask }}
        />
      )}
    </span>
  );
}
