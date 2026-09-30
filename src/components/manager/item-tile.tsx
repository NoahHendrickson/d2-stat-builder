"use client";

import { memo } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArmorThumb, type ArmorThumbSize } from "@/components/armor-thumb";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { BREAKER_NAMES, type InventoryItem } from "@/lib/inventory/build";
import { TAG_LABELS, useAnnotation } from "@/lib/inventory/annotations";
import { useMovePending } from "@/lib/inventory/move-queue";
import { cn } from "@/lib/utils";
import { useManagerActions } from "./manager-context";
import { useSearchState } from "./search-store";
import { TAG_ICONS } from "./tag-icons";

/** Height of the label bar under the icon (Figma: 12px on a 44px tile, scaled up). */
const FOOTER_PX = 16;
/** Full-tile overlays Bungie draws on crafted and enhanced weapons. */
const CRAFTED_OVERLAY = "/img/destiny_content/items/crafted-icon-overlay.png";
const ENHANCED_OVERLAY = "/img/destiny_content/items/enhanced-item-overlay.png";
/** The icon sits inside a 1px frame, so it is 2px narrower than the tile. */
const INNER_SIZE_CLASS: Partial<Record<ArmorThumbSize, string>> = {
  44: "size-[42px]",
  56: "size-[54px]",
};

/**
 * One inventory cell (Figma 127:5757 / 127:5737): the icon inside a 1px frame, over a
 * label bar in the frame colour with the weapon element and Power, or the stack size.
 * The frame is near-white, or gold with an inner gold glow when masterworked (Figma's
 * dark vignette is left out: on exotics it read as an inner shadow). Every tile
 * carries the bar (blank when there's nothing to show) so rows stay one height.
 * Click (or Enter) opens the move menu; drag it onto a character slot or the vault.
 */
export const ItemTile = memo(function ItemTile({
  item,
  size = 56,
}: {
  item: InventoryItem;
  size?: ArmorThumbSize;
}) {
  const actions = useManagerActions();
  const pending = useMovePending(item.key);
  const tag = useAnnotation(item.instanceId)?.tag;
  const search = useSearchState(item.key);
  const label = [
    item.name,
    item.typeName,
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
        "flex shrink-0 cursor-pointer flex-col self-start p-px outline-none select-none d2-hover-ring focus-visible:d2-tile-selected [&_img]:pointer-events-none",
        item.masterworked ? "bg-item-frame-masterwork" : "bg-item-frame",
        // A search dims what it doesn't match; with no search, archived items stay out
        // of the way (as in DIM).
        search === "miss"
          ? "opacity-20"
          : pending
            ? "opacity-50"
            : search === "none" && tag === "archive" && "opacity-60",
      )}
      style={{ width: size }}
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
        size={size}
        className={cn("bg-item-backing", INNER_SIZE_CLASS[size])}
        gearTier={item.gearTier}
      >
        {item.masterworked && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 shadow-[inset_0_0_6px_1px_rgba(255,235,103,0.45)]"
          />
        )}
        {/* The game's own overlays: the crafted and enhanced glyphs sit bottom-left. */}
        {(item.crafted || item.enhanced) && (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${item.crafted ? CRAFTED_OVERLAY : ENHANCED_OVERLAY}`}
            alt=""
            width={size}
            height={size}
            className="absolute inset-0 size-full max-w-none"
            unoptimized
          />
        )}
        {/* Deepsight: the game's orange-red border. */}
        {item.deepsight && (
          <span aria-hidden className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_2px_#d25336]" />
        )}
      </ArmorThumb>
      <span
        className="flex items-center gap-0.5 px-0.5 text-[11px] leading-none font-medium text-black tabular-nums"
        style={{ height: FOOTER_PX }}
      >
        {tag && <HugeiconsIcon icon={TAG_ICONS[tag]} className="size-3" strokeWidth={2.2} aria-hidden />}
        <span className="flex-1" />
        {/* The champion it stuns, beside the element; Bungie's icon is white, so blacken it. */}
        {item.breakerIcon && (
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

/** An empty cell, drawn as the game's bracket corners, the same size as a tile. */
export function EmptyTile({ size = 56 }: { size?: ArmorThumbSize }) {
  return (
    <span
      aria-hidden
      className="d2-brackets block shrink-0 self-start opacity-50"
      style={{ width: size, height: size + FOOTER_PX }}
    />
  );
}
