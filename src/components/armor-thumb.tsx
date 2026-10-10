"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { CRAFT_GLYPHS } from "@/components/craft-glyph-paths";

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
 * Moves the season glyph from Bungie's x 14 axis onto the strip's x 12.5 axis (Figma
 * 173:311), 1.5 units of 96 up and left.
 */
const ITEM_GLYPH_SHIFT = "-translate-x-[1.5625%] -translate-y-[1.5625%]";

/**
 * An item's watermark, drawn our way (Figma 173:311). Bungie's watermark PNG is a
 * black strip (x 2–26, y 2–92 of 96, fading out downwards) with the season glyph on
 * top (a 20px box centred on x 14, y 14). The strip is dropped: the PNG becomes a
 * luminance mask over white, so its black goes transparent and only the glyph stays
 * (every current glyph is greyscale). In its place goes our own strip, flush with the
 * art's top and left (x 0–25) and fading out like Bungie's (from 75% black), with the
 * glyph, the tier pips and the crafted / enhanced glyph all centred on its x 12.5 axis.
 * Under a crafted / enhanced glyph the fade runs on into the glyph's red at the foot.
 */
export function ItemWatermark({ watermark, craft }: { watermark: string; craft?: CraftKind }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-[26.042%] bg-linear-to-b from-black/75",
          craft
            ? "via-transparent via-55% to-[rgb(219_100_75/0.55)]"
            : "to-transparent to-95%",
        )}
      />
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 bg-white", ITEM_GLYPH_SHIFT)}
        style={{
          maskImage: `url(${BUNGIE_IMAGE_BASE}${watermark})`,
          maskMode: "luminance",
          maskSize: "100% 100%",
        }}
      />
    </>
  );
}

export type CraftKind = keyof typeof CRAFT_GLYPHS;

/**
 * Each glyph's box on the 96-unit grid (Bungie's are 18). The enhanced diamond is a
 * touch larger: its points leave more empty space in the box than the square does.
 */
const CRAFT_GLYPH_SIZE = { crafted: 14.7, enhanced: 17 } as const;
const CRAFT_GLYPH_Y = 80.5;

/**
 * The crafted (shaped) or enhanced glyph at the foot of the strip, as vectors (the
 * user's own designs, craft-glyph-paths.ts): Bungie's overlay PNGs are 96px with an
 * 18px glyph, which blurs when scaled. Fitted to its box centred on the strip's x 12.5
 * axis (Bungie's sit at x 14, y 82). Bungie's fill is #F19B83 with a rim shading down
 * to #DB644B; this is a step deeper than the fill, glowing in the rim's colour.
 */
export function CraftedGlyph({ kind }: { kind: CraftKind }) {
  const glyph = CRAFT_GLYPHS[kind];
  const scale = CRAFT_GLYPH_SIZE[kind] / Math.max(glyph.width, glyph.height);
  const w = glyph.width * scale;
  const h = glyph.height * scale;
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 96"
      className="pointer-events-none absolute inset-0 size-full drop-shadow-[0_0_2px_rgb(219_100_75/0.75)]"
    >
      <svg
        x={PIP_X - w / 2}
        y={CRAFT_GLYPH_Y - h / 2}
        width={w}
        height={h}
        viewBox={`0 0 ${glyph.width} ${glyph.height}`}
        fill="#E7806A"
      >
        {glyph.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </svg>
  );
}

/**
 * Tier pip geometry on the watermark's 96-unit grid (Figma 173:311): rounded squares
 * turned 45° (7.64 a side, so 10.8 across), centred on the strip's x 12.5 axis, 13.3
 * apart from y 32.8.
 */
const PIP_X = 12.5;
const PIP_SIDE = 7.64;
const PIP_FIRST_Y = 32.8;
const PIP_STEP = 13.3;
const pct = (units: number) => `${(units / 96) * 100}%`;

/**
 * Figma 173:311's conic fill: it sweeps clockwise from a seam that, once the square is
 * turned 45°, runs from the centre to the lower-left edge, darkest just past the seam
 * and lightest just before it. Gold for tier 5 (Figma's stops), light purple for
 * tier 4 (the same sweep), white to grey below that.
 */
const PIP_FILL = {
  gold: "conic-gradient(from 180deg, #F4BE0C 0%, #F5C41B 12.5%, #F7CA2A 25%, #F9D649 50%, #FCE368 75%, #FFEF86 100%)",
  purple: "conic-gradient(from 180deg, #A58BE0 0%, #AE96E5 12.5%, #B8A2EA 25%, #C9B8F0 50%, #DCCFF6 75%, #EEE7FC 100%)",
  white: "conic-gradient(from 180deg, #D6D6D6 0%, #E4E4E4 25%, #F2F2F2 50%, #FFFFFF 100%)",
};

/**
 * Armor 3.0 / weapon gear tier pips (2–5; tier 1 has none), drawn over a watermark
 * box of any size: white diamonds, light purple for tier 4, gold for tier 5. HTML
 * rather than SVG, which has no conic gradient.
 */
export function TierPips({ tier, className }: { tier: number; className?: string }) {
  if (tier < 2 || tier > 5) return null;
  const fill = tier === 5 ? PIP_FILL.gold : tier === 4 ? PIP_FILL.purple : PIP_FILL.white;
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {Array.from({ length: tier }, (_, i) => (
        <span
          key={i}
          className="absolute aspect-square rotate-45 rounded-[12%]"
          style={{
            width: pct(PIP_SIDE),
            left: pct(PIP_X - PIP_SIDE / 2),
            top: pct(PIP_FIRST_Y + i * PIP_STEP - PIP_SIDE / 2),
            backgroundImage: fill,
          }}
        />
      ))}
    </span>
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
  craft,
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
  /** A crafted or enhanced weapon: its glyph at the foot of the strip, which turns red there. */
  craft?: CraftKind;
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
      {watermark && <ItemWatermark watermark={watermark} craft={craft} />}
      {craft && <CraftedGlyph kind={craft} />}
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
