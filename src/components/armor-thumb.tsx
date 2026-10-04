"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";

const SIZE_CLASS = {
  20: "size-5",
  24: "size-6",
  32: "size-8",
  40: "size-10",
  44: "size-11",
  48: "size-12",
  52: "size-13",
  56: "size-14",
  64: "size-16",
} as const;

export type ArmorThumbSize = keyof typeof SIZE_CLASS;

/** In-game pip overlays for Armor 3.0 tiers 2–4 (T1 is blank; T5 uses our gold rail). */
const LOWER_TIER_OVERLAY: Record<2 | 3 | 4, string> = {
  2: "/img/destiny_content/items/inventory-item-tier2.png",
  3: "/img/destiny_content/items/inventory-item-tier3.png",
  4: "/img/destiny_content/items/inventory-item-tier4.png",
};

/**
 * Darkens the strip down the left of a tiered watermark (behind the season glyph and
 * tier pips). Bungie's art has it at ~15% black over x 2–25, y 2–92 of 96px; this
 * takes it to ~36% so the pips stand out. Goes under the watermark.
 */
export const TIER_STRIP_CLASS =
  "pointer-events-none absolute top-[2.083%] left-[2.083%] h-[94.79%] w-[25%] bg-black/25";

/**
 * Armor icon. The watermark renders whenever one is supplied (legacy and
 * lower-tier Armor 3.0 pieces carry one too). The pip rail matches gear
 * tier: five gold diamonds are Tier-5 only. The gold glow frame is for
 * pieces that are fully masterworked.
 */
export function ArmorThumb({
  icon,
  watermark,
  alt = "",
  size,
  masterworked = false,
  gearTier,
  className,
  children,
}: {
  icon?: string;
  watermark?: string;
  alt?: string;
  size: ArmorThumbSize;
  masterworked?: boolean;
  /** Armor 3.0 gear tier (1–5). 2–4 get the in-game pip overlay; 5 gets the gold rail. */
  gearTier?: number;
  className?: string;
  /** Extra overlays (e.g. a tile frame): over the watermark, under the tier pips and masterwork frame. */
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-none",
        SIZE_CLASS[size],
        className,
      )}
    >
      {icon ? (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${icon}`}
          alt={alt}
          width={size}
          height={size}
          className="size-full max-w-none"
          unoptimized
        />
      ) : (
        <span className="bg-muted block size-full" aria-hidden />
      )}
      {watermark && gearTier !== undefined && <span aria-hidden className={TIER_STRIP_CLASS} />}
      {watermark && (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${watermark}`}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full max-w-none"
          unoptimized
        />
      )}
      {children}
      {gearTier === 5 && (
        <Image
          src="/loadout/tier-5-pips.svg"
          alt=""
          width={size}
          height={size}
          className="pointer-events-none absolute top-[32.8125%] left-[9.375%] h-[59.375%] w-[11.16%] max-w-none"
        />
      )}
      {(gearTier === 2 || gearTier === 3 || gearTier === 4) && (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${LOWER_TIER_OVERLAY[gearTier]}`}
          alt=""
          width={size}
          height={size}
          className="pointer-events-none absolute inset-0 size-full max-w-none"
          unoptimized
        />
      )}
      {masterworked && (
        <span
          className="pointer-events-none absolute inset-0 border border-exotic-line shadow-[inset_0_0_12px_rgba(255,240,107,0.5)]"
          aria-hidden
        />
      )}
    </span>
  );
}
