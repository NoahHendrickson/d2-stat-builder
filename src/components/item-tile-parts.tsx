import Image from "next/image";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";

// Pieces of the Manager's item tile (manager/item-tile.tsx) that other item art reuses
// (loadout cards), kept apart so those pages don't pull in the Manager's modules.

/** Height of the label bar under the icon (Figma: 12px on a 44px tile, scaled up). */
export const ITEM_TILE_FOOTER_PX = 16;

/** The inner gold glow over a masterworked item's icon (its frame turns gold too). */
export function MasterworkGlow() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 shadow-[inset_0_0_6px_1px_rgba(255,235,103,0.45)]"
    />
  );
}

/**
 * Armor archetype beside the Power: its primary stat's glyph, blackened like the
 * others. The 51px stat icons pad their glyphs by 4px or more a side, so crop to the
 * middle 43px to keep the glyph legible at this size.
 */
export function ArchetypeGlyph({ icon }: { icon: string }) {
  return (
    <span className="relative size-3.5 shrink-0 overflow-hidden">
      <Image
        src={`${BUNGIE_IMAGE_BASE}${icon}`}
        alt=""
        width={51}
        height={51}
        className="absolute -top-[9.302%] -left-[9.302%] h-auto w-[118.605%] max-w-none brightness-0"
        unoptimized
      />
    </span>
  );
}
