"use client";

import { memo, type CSSProperties } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArmorThumb } from "@/components/armor-thumb";
import {
  ArchetypeGlyph,
  ITEM_TILE_FOOTER_PX,
  MasterworkGlow,
} from "@/components/item-tile-parts";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { BREAKER_NAMES, type InventoryItem } from "@/lib/inventory/build";
import { TAG_LABELS, useAnnotation } from "@/lib/inventory/annotations";
import { useMovePending } from "@/lib/inventory/move-queue";
import { cn } from "@/lib/utils";
import { useManagerActions, usePhoneLayout, useTileMetrics } from "./manager-context";
import { useSearchState } from "./search-store";
import { TAG_ICONS } from "./tag-icons";
import { FavoriteHeart } from "@/components/favorite-heart";

const FOOTER_PX = ITEM_TILE_FOOTER_PX;
/**
 * Desktop tiles narrower than this (the picked size) set the label bar's glyphs and Power
 * flush (champion, element, Power). Phone tiles keep the bar as it was at every width.
 */
const ROOMY_FOOTER_PX = 56;
/** Desktop tiles narrower than this leave a weapon's champion glyph to the tooltip. */
const CHAMPION_FOOTER_PX = 48;

/**
 * One inventory cell (Figma 127:5757 / 127:5737): the icon inside a 1px frame, over a
 * label bar in the frame colour with the weapon element and Power, or the stack size.
 * The frame is grey, or gold with an inner gold glow when masterworked (Figma's
 * dark vignette is left out: on exotics it read as an inner shadow). Every tile
 * carries the bar (blank when there's nothing to show) so rows stay one height.
 * Its size is the page's (see useTileMetrics): picked in the Items settings, or fitted to a
 * phone's width.
 * Click (or Enter) opens the move menu; drag it onto a character slot or the vault.
 */
export const ItemTile = memo(function ItemTile({ item }: { item: InventoryItem }) {
  const actions = useManagerActions();
  const width = useTileMetrics().tile;
  const phone = usePhoneLayout();
  const roomyFooter = phone || width >= ROOMY_FOOTER_PX;
  const championInFooter = phone || width >= CHAMPION_FOOTER_PX;
  const pending = useMovePending(item.key);
  const tag = useAnnotation(item.instanceId)?.tag;
  const search = useSearchState(item.key);
  const label = [
    item.name,
    item.typeName,
    item.archetype?.name,
    item.power ? `Power ${item.power}` : undefined,
    item.breakerType ? BREAKER_NAMES[item.breakerType] : undefined,
    item.crafted ? "Crafted" : item.enhanced ? "Enhanced" : undefined,
    item.deepsight ? "Deepsight resonance" : undefined,
    tag ? `Tagged ${TAG_LABELS[tag]}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const showQuantity = item.quantity > 1;

  return (
    // A div, not a button: Firefox won't start a drag on a <button>. self-start: never
    // stretched by a flex row. Images ignore the pointer so the drag grabs the whole tile.
    <div
      role="button"
      tabIndex={0}
      draggable={Boolean(actions)}
      className={cn(
        "flex shrink-0 cursor-pointer flex-col self-start p-px outline-none select-none transition-[opacity,outline-offset] duration-150 d2-hover-ring focus-visible:d2-tile-selected [&_img]:pointer-events-none",
        item.masterworked ? "bg-item-frame-masterwork" : "bg-item-frame",
        // A search dims what it doesn't match; with no search, archived items stay out
        // of the way (as in DIM).
        search === "miss"
          ? "opacity-20"
          : pending
            ? "opacity-50"
            : search === "none" && tag === "archive" && "opacity-60",
      )}
      // The icon sits inside a 1px frame, so it is 2px narrower than the tile.
      style={{ width, "--tile-inner": `${width - 2}px` } as CSSProperties}
      title={label}
      aria-label={label.replaceAll("\n", ", ")}
      aria-busy={pending || undefined}
      onClick={(e) => actions?.open(item, e.currentTarget)}
      onDoubleClick={() => actions?.quickEquip(item)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        actions?.open(item, e.currentTarget);
      }}
      onDragStart={(e) => {
        if (!actions?.dragStart(item)) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.name);
      }}
      onDragEnd={() => actions?.dragEnd()}
    >
      <ArmorThumb
        icon={item.icon}
        watermark={item.watermark}
        size={60}
        className="bg-item-backing size-(--tile-inner)"
        gearTier={item.gearTier}
        craft={item.enhanced ? "enhanced" : item.crafted ? "crafted" : undefined}
      >
        {item.masterworked && <MasterworkGlow />}
        {/* The tag as a tab in the frame colour off the top-right corner: the label bar
            is too full to hold it at a legible size. Its own title replaces the tile's
            while hovered. */}
        {tag && (
          <span
            aria-hidden
            title={`Marked as ${TAG_LABELS[tag].toLowerCase()}`}
            className={cn(
              "absolute top-0 right-0 flex size-4 items-center justify-center text-black",
              item.masterworked ? "bg-item-frame-masterwork" : "bg-item-frame",
            )}
          >
            {tag === "favorite" ? (
              // Deeper pink than elsewhere: the tab is the light frame colour.
              <FavoriteHeart className="text-pink-600 fill-pink-600/35" />
            ) : (
              <HugeiconsIcon icon={TAG_ICONS[tag]} className="size-3" strokeWidth={2} />
            )}
          </span>
        )}
        {/* Deepsight: the game's orange-red border. */}
        {item.deepsight && (
          <span aria-hidden className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_2px_#d25336]" />
        )}
      </ArmorThumb>
      <span
        className={cn(
          // Whatever doesn't fit is clipped at the frame rather than spilling past it; a
          // narrower tile closes up a crowded bar (champion + element + Power) first.
          "flex items-center overflow-hidden px-0.5 text-[11px] leading-none font-medium text-black tabular-nums",
          roomyFooter && "gap-0.5",
        )}
        style={{ height: FOOTER_PX }}
      >
        <span className="flex-1" />
        {item.archetype?.icon && <ArchetypeGlyph icon={item.archetype.icon} />}
        {/* The champion it stuns, beside the element; Bungie's icon is white, so blacken it. */}
        {item.breakerIcon && championInFooter && (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${item.breakerIcon}`}
            alt=""
            width={12}
            height={12}
            className="size-3 brightness-0"
            unoptimized
          />
        )}
        {item.damageIcon && (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${item.damageIcon}`}
            alt=""
            width={12}
            height={12}
            // Kinetic's glyph is uncoloured; grey it so it reads as "no element".
            className={cn("size-3", item.element === "kinetic" && "opacity-50 brightness-0")}
            unoptimized
          />
        )}
        {showQuantity ? item.quantity.toLocaleString() : item.power}
      </span>
    </div>
  );
});

/** An empty cell, drawn as the game's bracket corners over a faint fill, the same size as a tile. */
export function EmptyTile() {
  const width = useTileMetrics().tile;
  return (
    <span
      aria-hidden
      className="d2-brackets block shrink-0 self-start"
      // Fainter brackets than elsewhere: the fill already marks the cell.
      style={
        {
          width,
          height: width + FOOTER_PX,
          "--bracket": "color-mix(in srgb, var(--foreground) 20%, transparent)",
          "--bracket-fill": "color-mix(in srgb, var(--foreground) 4%, transparent)",
        } as CSSProperties
      }
    />
  );
}
