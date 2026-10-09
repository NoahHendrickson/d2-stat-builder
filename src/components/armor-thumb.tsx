"use client";

import { useId, type ReactNode } from "react";
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
  60: "size-15",
  64: "size-16",
} as const;

export type ArmorThumbSize = keyof typeof SIZE_CLASS;

/**
 * Darkens the strip down the left of a tiered watermark (behind the season glyph and
 * tier pips). Bungie's art has it at ~15% black over x 2–25, y 2–92 of 96px; this
 * takes it to ~36% so the pips stand out. Goes under the watermark.
 */
export const TIER_STRIP_CLASS =
  "pointer-events-none absolute top-[2.083%] left-[2.083%] h-[94.79%] w-[25%] bg-black/25";

/**
 * Tier pip geometry on the watermark's 96-unit grid. Centred on the strip (x 2–26),
 * a little larger than Bungie's tier 2–4 overlays (10 × 9 at x 14, 13 apart from
 * y 30), starting 2 higher so five still fit above the strip's foot.
 */
const PIP_X = 14;
const PIP_HALF_W = 5.75;
const PIP_HALF_H = 5.25;
const PIP_TOP = 28;
const PIP_STEP = 13;

/**
 * Armor 3.0 / weapon gear tier pips (2–5; tier 1 has none), drawn over a watermark
 * box of any size: white diamonds, gold for tier 5.
 */
export function TierPips({ tier, className }: { tier: number; className?: string }) {
  const id = useId();
  if (tier < 2 || tier > 5) return null;
  const gold = tier === 5;
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 96"
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
    >
      <defs>
        {gold ? (
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#C4920A" />
            <stop offset="0.4" stopColor="#E8C411" />
            <stop offset="0.7" stopColor="#FFE566" />
            <stop offset="1" stopColor="#FFF6C8" />
          </linearGradient>
        ) : (
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#D6D6D6" />
          </linearGradient>
        )}
      </defs>
      <g fill={`url(#${id})`}>
        {Array.from({ length: tier }, (_, i) => {
          const cy = PIP_TOP + PIP_HALF_H + i * PIP_STEP;
          return (
            <polygon
              key={i}
              points={`${PIP_X},${cy - PIP_HALF_H} ${PIP_X + PIP_HALF_W},${cy} ${PIP_X},${cy + PIP_HALF_H} ${PIP_X - PIP_HALF_W},${cy}`}
            />
          );
        })}
      </g>
    </svg>
  );
}

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
  /** Armor 3.0 / weapon gear tier (1–5); 2–5 get pips (`TierPips`). */
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
      {gearTier !== undefined && <TierPips tier={gearTier} />}
      {masterworked && (
        <span
          className="pointer-events-none absolute inset-0 border border-exotic-line shadow-[inset_0_0_12px_rgba(255,240,107,0.5)]"
          aria-hidden
        />
      )}
    </span>
  );
}
