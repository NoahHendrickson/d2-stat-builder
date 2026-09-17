"use client";

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
  64: "size-16",
} as const;

export type ArmorThumbSize = keyof typeof SIZE_CLASS;

/**
 * Armor icon. Watermark, T5 pip rail, and gold glow frame are Armor 3.0 only —
 * Armor 2.0 / un-tiered pieces (including legacy exotics) render the icon alone.
 */
export function ArmorThumb({
  icon,
  watermark,
  alt = "",
  size,
  exoticFrame = false,
  isTier5 = false,
  className,
}: {
  icon?: string;
  watermark?: string;
  alt?: string;
  size: ArmorThumbSize;
  exoticFrame?: boolean;
  isTier5?: boolean;
  className?: string;
}) {
  const tiered = isTier5;
  const goldFrame = exoticFrame && tiered;
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-[2px] d2:rounded-none",
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
      {tiered && watermark && (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${watermark}`}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full max-w-none"
          unoptimized
        />
      )}
      {tiered && (
        // Scaled from the 64px editor thumb (7.14×38 at left 6 / top 21).
        <img
          src="/loadout/tier-5-pips.svg"
          alt=""
          className="pointer-events-none absolute top-[32.8125%] left-[9.375%] h-[59.375%] w-[11.16%]"
        />
      )}
      {goldFrame && (
        <span
          className="pointer-events-none absolute inset-0 border-2 border-exotic-line shadow-[inset_0_0_12px_rgba(255,240,107,0.5)]"
          aria-hidden
        />
      )}
    </span>
  );
}
