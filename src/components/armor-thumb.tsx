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
 * Armor icon. The watermark renders whenever one is supplied (legacy and
 * lower-tier Armor 3.0 pieces carry one too). The T5 pip rail is Tier-5 only;
 * the gold glow frame follows `exoticFrame`.
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
      {isTier5 && (
        <Image
          src="/loadout/tier-5-pips.svg"
          alt=""
          width={size}
          height={size}
          className="pointer-events-none absolute top-[32.8125%] left-[9.375%] h-[59.375%] w-[11.16%] max-w-none"
        />
      )}
      {exoticFrame && (
        <span
          className="pointer-events-none absolute inset-0 border-2 border-exotic-line shadow-[inset_0_0_12px_rgba(255,240,107,0.5)]"
          aria-hidden
        />
      )}
    </span>
  );
}
