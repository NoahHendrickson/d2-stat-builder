"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ClassGlyph, classGlyphWidth } from "@/components/class-glyph";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ASCENDANT_SHARD_HASH,
  ENHANCEMENT_CORE_HASH,
  ENHANCEMENT_PRISM_HASH,
  GLIMMER_HASH,
} from "@/lib/armory/masterwork";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { ACCOUNT_ROWS, SLOT_ROWS, VAULT_GROUPS } from "@/lib/inventory/buckets";
import {
  ASCENDANT_ALLOY_HASH,
  BRIGHT_DUST_HASH,
  OTHER_BUCKET,
  type InventoryItem,
  type ManagerInventory,
} from "@/lib/inventory/build";
import {
  groupItems,
  setViewSettings,
  useViewSettings,
  VAULT_TAB_LABELS,
  VAULT_TABS,
  type GroupKey,
  type ItemGroup,
  type VaultTab,
  type ViewSettings,
} from "@/lib/inventory/view-settings";
import {
  GROUP_GAP_X_PX,
  MARKER_GAP_PX,
  TILE_WIDTH_PX,
  layoutVault,
  lineOfItem,
  linesBetween,
  type TileMetrics,
  type VaultBucket,
  type VaultCaptionLine,
  type VaultSection,
  type VaultTileLine,
} from "@/lib/inventory/vault-layout";
import { cn } from "@/lib/utils";
import { weaponTypeIcon } from "@/lib/weapons/weapon-type-icon-paths";
import { useStoreValue } from "@/lib/value-store";
import { ItemTile } from "./item-tile";
import { useItemComparator } from "./view-menu";
import { PINNED_PLATE, dragStore, usePhoneLayout, useTileMetrics } from "./manager-context";
import { PLATE_HEIGHT, STRIP_HEIGHT } from "./character-plate";
import { DropZone } from "./manager-drop-zone";

/** Above and below a slot's tiles: the slot rows' drop zones are padded this much. */
const SLOT_PAD_PX = 4;

/**
 * Where the vault's header sits, which sets how it pins and how tall its nameplate is:
 * behind the phone's Vault `tab`; `below` the character columns or rows, pinned across the
 * page's width; `beside` the character rows, pinned to the top of its own pane. Beside or
 * below the rows, the nameplate is as tall as the character strips.
 */
export type VaultPlacement = "tab" | "below-columns" | "below-rows" | "beside-rows";

/** Below the characters: across the page's whole width, gutters too, like the search bar. */
const PINNED_BELOW =
  "sticky top-8 z-10 -mx-4 -mt-3 px-4 py-3 group-data-scrolled/manager:d2-sticky-fill lg:-mx-6 lg:px-6";

const HEADER_PLACEMENTS: Record<
  VaultPlacement | "aligned" | "aligned-compact",
  { className: string; plate: string }
> = {
  tab: { className: "pb-3", plate: PLATE_HEIGHT },
  "below-columns": { className: PINNED_BELOW, plate: PLATE_HEIGHT },
  "below-rows": { className: PINNED_BELOW, plate: STRIP_HEIGHT },
  "beside-rows": {
    className: "sticky top-0 z-10 pb-3 group-data-scrolled/vault:d2-sticky-fill",
    plate: STRIP_HEIGHT,
  },
  // Beside the nameplates, the header runs on into the postmasters' row (the vault has
  // none), so its tabs don't stretch the nameplate row and leave a band under them.
  aligned: { className: cn(PINNED_PLATE, "row-span-2 self-start"), plate: PLATE_HEIGHT },
  // Compact, it shares the character tabs' row, its own tabs level with theirs.
  "aligned-compact": { className: cn(PINNED_PLATE, "justify-between"), plate: PLATE_HEIGHT },
};

/** Height the class sigil draws at beside a group of armor. */
const CLASS_MARKER_PX = 32;

/** Width of a group's marker (see GroupMarker), or 0 when its grouping draws none. */
function markerWidth(groupBy: GroupKey, { items }: ItemGroup): number {
  const item = items[0];
  if (!item) return 0;
  if (groupBy === "class") return classGlyphWidth(item.classType, CLASS_MARKER_PX);
  // Only weapons have an ammo type; a type without a silhouette keeps its column.
  return groupBy === "type" && item.ammoType !== undefined ? TILE_WIDTH_PX : 0;
}

/**
 * The vault as sections of sorted, grouped buckets, ready to lay out: the tab's gear
 * (one bucket per character slot, keyed by its hash), then (on All) what has no row of
 * its own and the account-wide inventories. On phones every bucket and group is named in
 * text above its tiles, in place of the markers beside them.
 */
function vaultSections(
  { vault, account }: ManagerInventory,
  compare: (a: InventoryItem, b: InventoryItem) => number,
  { weaponGroup, armorGroup, vaultTab }: ViewSettings,
  phone: boolean,
): { gear: VaultSection[]; extra: VaultSection[] } {
  const bucket = (
    key: string,
    label: string | undefined,
    items: readonly InventoryItem[] | undefined,
    groupBy: GroupKey,
  ): VaultBucket => ({
    key,
    label,
    groupBy,
    groups: groupItems([...(items ?? [])].sort(compare), groupBy),
    ...(phone
      ? // Each group on its own lines under its name.
        { stacked: true, markerWidth: () => 0, captions: true }
      : // No text labels: groups sit side by side, except types, which get a line each.
        { stacked: groupBy === "type", markerWidth: (group: ItemGroup) => markerWidth(groupBy, group) }),
  });
  // Weapons and armor each follow their own grouping; the rest isn't grouped.
  const groupFor = (label: string): GroupKey =>
    label === "Weapons" ? weaponGroup : label === "Armor" ? armorGroup : "none";
  // The Weapons and Armor tabs show just that section; All shows every one.
  const shown =
    vaultTab === "all" ? VAULT_GROUPS : VAULT_GROUPS.filter((g) => g.label === VAULT_TAB_LABELS[vaultTab]);
  const gear: VaultSection[] = shown.map((group) => ({
    heading: group.label,
    buckets: group.rows.map((row) =>
      bucket(String(row.hash), row.label, vault[row.hash], groupFor(group.label)),
    ),
  }));
  const extra: VaultSection[] = [];
  if (vaultTab === "all") {
    const other = vault[OTHER_BUCKET] ?? [];
    if (other.length > 0) {
      extra.push({ heading: "Other", buckets: [bucket("other", undefined, other, "none")] });
    }
    extra.push({
      heading: "Account",
      buckets: ACCOUNT_ROWS.map((row) =>
        bucket(`account:${row.hash}`, row.label, account[row.hash], "none"),
      ),
    });
  }
  return { gear, extra };
}

function useVaultSections(inventory: ManagerInventory) {
  const view = useViewSettings();
  const compare = useItemComparator();
  const phone = usePhoneLayout();
  return useMemo(
    () => vaultSections(inventory, compare, view, phone),
    [inventory, compare, view, phone],
  );
}

const NO_SECTIONS: readonly VaultSection[] = [];

/**
 * The legacy layout's vault, as the grid's last column (a subgrid on the characters' rows):
 * its tabs and header beside the nameplates and postmasters, then each slot's tiles level
 * with that slot on the characters, and last what no character slot holds. The whole
 * column is one drop target.
 */
export function AlignedVault({
  inventory,
  headerRows,
  rowSpan,
}: {
  inventory: ManagerInventory;
  /** Rows above the postmasters' row: the vault's header takes the first. */
  headerRows: number;
  rowSpan: number;
}) {
  const { gear, extra } = useVaultSections(inventory);
  // Each slot's bucket on its own, without a heading: the row it's on names it.
  const bySlot = useMemo(
    () => new Map(gear.flatMap((section) => section.buckets).map((b) => [b.key, [{ buckets: [b] }]])),
    [gear],
  );

  return (
    <DropZone
      to={{ kind: "vault" }}
      label="Vault"
      className="grid min-w-0 grid-rows-subgrid pl-3"
      style={{ gridColumn: "-2", gridRow: `1 / span ${rowSpan}` }}
    >
      {headerRows === 1 ? (
        <VaultHeader inventory={inventory} placement="aligned" />
      ) : (
        <>
          <VaultHeader inventory={inventory} placement="aligned-compact" />
          {/* Down to the postmasters' row: nothing of the vault's own. */}
          <div style={{ gridRow: `span ${headerRows}` }} />
        </>
      )}
      {SLOT_ROWS.map(({ row, groupStart }) => (
        <div key={row.hash} className={cn("min-w-0 pb-2", groupStart && "pt-5")}>
          <VaultLines sections={bySlot.get(String(row.hash)) ?? NO_SECTIONS} pad={SLOT_PAD_PX} />
        </div>
      ))}
      <div className="min-w-0 pb-4">
        <VaultLines sections={extra} />
      </div>
    </DropZone>
  );
}

/**
 * The vault as one list under section headings; one drop target. `placement` says where
 * it sits, which sets how its header pins.
 */
export function VaultPane({
  inventory,
  placement,
}: {
  inventory: ManagerInventory;
  placement: VaultPlacement;
}) {
  const { gear, extra } = useVaultSections(inventory);
  const sections = useMemo(() => [...gear, ...extra], [gear, extra]);

  return (
    <DropZone to={{ kind: "vault" }} className="flex min-w-0 flex-col">
      <section aria-label="Vault" className="flex flex-col">
        <VaultHeader inventory={inventory} placement={placement} />
        <div className="flex flex-col pb-4">
          <VaultLines sections={sections} />
        </div>
      </section>
    </DropZone>
  );
}

/** The vault's nameplate with the currencies beside it, then its tabs, pinned per `placement`. */
function VaultHeader({
  inventory,
  placement,
}: {
  inventory: ManagerInventory;
  placement: keyof typeof HEADER_PLACEMENTS;
}) {
  const { className, plate } = HEADER_PLACEMENTS[placement];
  return (
    <div className={cn("flex flex-col", className)}>
      {/* The currencies drop under the nameplate when the column is too narrow for both. */}
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <VaultTitle inventory={inventory} height={plate} />
        <VaultCurrencies inventory={inventory} />
      </div>
      <VaultTabs inventory={inventory} />
    </div>
  );
}

/**
 * Which of the vault's sections to show: everything, or just weapons or armor (each with
 * how many the vault holds).
 */
function VaultTabs({ inventory }: { inventory: ManagerInventory }) {
  const view = useViewSettings();
  const { vault } = inventory;
  const count = (tab: VaultTab) =>
    VAULT_GROUPS.find((g) => g.label === VAULT_TAB_LABELS[tab])?.rows.reduce(
      (n, row) => n + (vault[row.hash]?.length ?? 0),
      0,
    );
  return (
    <div className="border-b border-foreground/12">
      <Tabs
        value={view.vaultTab}
        onValueChange={(tab) => setViewSettings({ ...view, vaultTab: tab as VaultTab })}
        className="flex-none"
      >
        <TabsList variant="line" aria-label="Vault sections" className="border-b-0">
          {VAULT_TABS.map((tab) => {
            const n = tab === "all" ? undefined : count(tab);
            return (
              <TabsTrigger key={tab} value={tab} className="flex-none">
                <span className="tabular-nums">
                  {VAULT_TAB_LABELS[tab]}
                  {n !== undefined && ` (${n})`}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}

/** Kept mounted past each edge of the viewport, so a scroll brings in tiles, not gaps. */
const VAULT_OVERSCAN_PX = 400;
/** The mounted stretch moves in steps this size: a scroll re-renders once a step, not once a frame. */
const VAULT_STEP_PX = 200;

/**
 * The vault's headings and tiles, with only the lines near the viewport mounted. Every
 * line's place comes from the layout (see vault-layout.ts), so the list keeps its full
 * height and the scrollbar its size however little of it is drawn. The inventory itself
 * is untouched: search, totals, and bulk actions still see every item.
 */
function VaultLines({ sections, pad }: { sections: readonly VaultSection[]; pad?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** The stretch of the list to keep mounted, as offsets from its top. */
  const [span, setSpan] = useState<readonly [number, number]>([0, 0]);
  const [focused, setFocused] = useState<string | null>(null);
  const drag = useStoreValue(dragStore);
  const metrics = useTileMetrics();
  const layout = useMemo(
    () => layoutVault(sections, width, pad, metrics),
    [sections, width, pad, metrics],
  );

  // Measured before paint (so the first frame already has its tiles), then on anything
  // that moves the list against the viewport. Capture, because scroll events don't
  // bubble from the page's scroller.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Hidden along with its view (the router keeps recent views mounted): keep what it had.
      if (el.clientWidth === 0) return;
      setWidth(el.clientWidth);
      const { top } = el.getBoundingClientRect();
      const from = Math.floor((-top - VAULT_OVERSCAN_PX) / VAULT_STEP_PX) * VAULT_STEP_PX;
      const to =
        Math.ceil((window.innerHeight - top + VAULT_OVERSCAN_PX) / VAULT_STEP_PX) * VAULT_STEP_PX;
      setSpan((prev) => (prev[0] === from && prev[1] === to ? prev : [from, to]));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      resize.disconnect();
      document.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, []);

  const [start, end] = linesBetween(layout.lines, span[0], span[1]);
  // Two lines stay mounted wherever the list is scrolled: the one last focused (a tile
  // that opened the item panel is its anchor, and a focused tile shouldn't lose focus by
  // scrolling) and the one a drag started on (a removed drag source never gets its dragend).
  const kept = [
    focused === null ? -1 : layout.lines.findIndex((line) => line.key === focused),
    drag ? lineOfItem(layout.lines, drag.item.key) : -1,
  ].filter((i) => i >= 0 && (i < start || i >= end));
  const shown = [
    ...new Set([...kept, ...Array.from({ length: end - start }, (_, i) => start + i)]),
  ].sort((a, b) => a - b);

  return (
    <div
      ref={ref}
      className="relative shrink-0"
      style={{ height: layout.height }}
      onFocus={(e) =>
        setFocused((e.target as HTMLElement).closest<HTMLElement>("[data-line]")?.dataset.line ?? null)
      }
    >
      {shown.map((i) => {
        const line = layout.lines[i]!;
        return line.kind === "heading" ? (
          <h2 key={line.key} className="d2-label absolute inset-x-0 pt-5 pb-1" style={{ top: line.top }}>
            {line.label}
          </h2>
        ) : line.kind === "caption" ? (
          <VaultCaption key={line.key} line={line} />
        ) : (
          <VaultLineRow key={line.key} line={line} tiles={metrics} />
        );
      })}
    </div>
  );
}

/**
 * Phones: a slot's name ("Kinetic") or one of its groups' ("Hand Cannon"), with how many
 * items it holds, on the line above its tiles.
 */
function VaultCaption({ line }: { line: VaultCaptionLine }) {
  const Tag = line.level === "bucket" ? "h3" : "p";
  return (
    <Tag
      className={cn(
        "absolute inset-x-0 flex items-end gap-2 pb-1.5",
        line.level === "bucket" ? "text-sm font-medium" : "text-muted-foreground text-xs",
      )}
      style={{ top: line.top, height: line.height }}
    >
      <span className="min-w-0 truncate">{line.label}</span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{line.count}</span>
    </Tag>
  );
}

/** One line of vault tiles: a group's (or a few small groups'), each after its marker's column. */
const VaultLineRow = memo(function VaultLineRow({ line, tiles }: { line: VaultTileLine; tiles: TileMetrics }) {
  return (
    <div
      role="group"
      aria-label={line.label}
      data-line={line.key}
      className="absolute inset-x-0 flex items-start"
      style={{ top: line.top, paddingTop: line.padTop, columnGap: GROUP_GAP_X_PX }}
    >
      {line.cells.map((cell) => (
        <div key={cell.key} className="flex items-start">
          {cell.markerWidth > 0 && (
            // Centred on the tile's icon, above its footer bar.
            <span
              className="flex shrink-0 items-center"
              style={{ width: cell.markerWidth, height: tiles.tile, marginRight: MARKER_GAP_PX }}
            >
              {cell.marker && <GroupMarker groupBy={line.groupBy} item={cell.marker} />}
            </span>
          )}
          <div className="flex" style={{ gap: tiles.gap }}>
            {cell.items.map((item) => (
              <ItemTile key={item.key} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

/**
 * The game's vault sigil. The plain one (the Vault vendor's smallTransparentIcon) is only
 * 48px and blurs when scaled up, so this is the vendor's 360px largeTransparentIcon, which
 * draws the sigil inside a shield outline: the crop shows just the sigil (236×154 at x 66,
 * y 18), as background percentages so it holds at any width.
 */
const VAULT_SIGIL = `${BUNGIE_IMAGE_BASE}/common/destiny2_content/icons/9e92b994196275ad1a2f89946b2e65a4.png`;
const VAULT_SIGIL_CROP = {
  size: `${(360 / 236) * 100}% auto`,
  position: `${(66 / (360 - 236)) * 100}% ${(18 / (360 - 154)) * 100}%`,
};

/**
 * The vault's nameplate above its tabs: a grey emblem the width of a character's, with the
 * vault sigil, "Vault", how full it is, and a fill bar along the bottom that turns red near full.
 */
function VaultTitle({
  inventory: { vaultCount, vaultCapacity },
  height,
}: {
  inventory: ManagerInventory;
  /** As tall as the character nameplates beside it (PLATE_HEIGHT or STRIP_HEIGHT). */
  height: string;
}) {
  const fill = vaultCapacity ? Math.min(vaultCount / vaultCapacity, 1) : 0;
  // Red from here on: the count and the bar together.
  const nearFull = fill >= 0.95;
  return (
    <div className="w-70 max-w-full shrink-0">
      {/* Always dark, like an emblem, so it takes the dark palette (its red) in either mode. */}
      <div
        className={cn(
          "dark relative w-full overflow-hidden bg-[#4a4d53] normal:rounded-[12px]",
          height,
        )}
      >
        <div
          aria-hidden
          className="absolute top-1/2 left-2.5 aspect-[236/154] w-15 -translate-y-1/2 bg-no-repeat"
          style={{
            backgroundImage: `url(${VAULT_SIGIL})`,
            backgroundSize: VAULT_SIGIL_CROP.size,
            backgroundPosition: VAULT_SIGIL_CROP.position,
          }}
        />
        <div className="absolute inset-y-0 right-0 flex flex-col items-end justify-center gap-1 px-3 pb-1 text-right">
          <h2 className="text-lg leading-tight font-medium text-white">Vault</h2>
          <span className="text-xs leading-none text-white/75 tabular-nums">
            <span className={cn("font-medium", nearFull ? "text-destructive" : "text-white")}>
              {vaultCount.toLocaleString()}
            </span>
            {vaultCapacity ? ` / ${vaultCapacity.toLocaleString()}` : ""}
          </span>
        </div>
        {vaultCapacity !== undefined && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/30">
            <div
              className={cn("h-full", nearFull ? "bg-destructive" : "bg-white/70")}
              style={{ width: `${fill * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Each currency's box takes its colour from the currency's artwork. */
const CURRENCY_TINTS: Record<number, string> = {
  [GLIMMER_HASH]: "#4fc3e8",
  [BRIGHT_DUST_HASH]: "#f5b98a",
  [ENHANCEMENT_CORE_HASH]: "#f39a2b",
  [ENHANCEMENT_PRISM_HASH]: "#e6c229",
  [ASCENDANT_SHARD_HASH]: "#dfe4ea",
  [ASCENDANT_ALLOY_HASH]: "#e0552b",
};

/** The account's currencies and upgrade materials, a tinted box each, in two rows. */
function VaultCurrencies({ inventory: { currencies } }: { inventory: ManagerInventory }) {
  if (currencies.length === 0) return null;
  return (
    <div
      className="grid min-w-0 gap-1.5"
      style={{ gridTemplateColumns: `repeat(${Math.ceil(currencies.length / 2)}, max-content)` }}
      aria-label="Currencies"
    >
      {currencies.map((c) => {
        const tint = CURRENCY_TINTS[c.itemHash] ?? "var(--foreground)";
        return (
          // The icon says what it is; the name is left to the tooltip.
          <div
            key={c.itemHash}
            title={c.name}
            className="flex items-center gap-1.5 border py-0.5 pr-2 pl-0.5 text-xs font-medium tabular-nums normal:rounded-md"
            style={{
              borderColor: `color-mix(in srgb, ${tint} 65%, transparent)`,
              background: `color-mix(in srgb, ${tint} 20%, transparent)`,
            }}
          >
            {c.icon ? (
              <Image
                src={`${BUNGIE_IMAGE_BASE}${c.icon}`}
                alt={c.name}
                width={18}
                height={18}
                className="size-[18px] shrink-0 normal:rounded-sm"
                unoptimized
              />
            ) : (
              <span className="sr-only">{c.name}</span>
            )}
            {c.quantity.toLocaleString()}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What a vault group is, as a picture in the column beside its tiles: the weapon type's
 * silhouette or the class sigil. Other groupings, armor types, and any-class items have
 * no column (see markerWidth).
 */
function GroupMarker({ groupBy, item }: { groupBy: GroupKey; item: InventoryItem }) {
  if (groupBy === "class") {
    return <ClassGlyph classType={item.classType} className="text-muted-foreground h-8 w-auto" />;
  }
  const icon = groupBy === "type" ? weaponTypeIcon(item.typeName, item.ammoType) : undefined;
  if (!icon) return null;
  const mask = `url("${icon}") left center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-label={item.typeName}
      title={item.typeName}
      className="bg-muted-foreground h-5 w-full"
      style={{ mask, WebkitMask: mask }}
    />
  );
}
