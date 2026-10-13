"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { cn } from "@/lib/utils";

/**
 * Bungie's stat glyphs are white at ~70% alpha. As a mask filled with the text colour,
 * stacked three times (each layer covers what's left: 1 − 0.3³ ≈ 97%), the glyph comes
 * out solid in its label's colour and opacity.
 */
function tintStyle(url: string): React.CSSProperties {
  const image = `url(${url}), url(${url}), url(${url})`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
}

/** A 16px Bungie stat (or plug) icon with a tooltip, or an empty square without `src`. */
export function StatGlyph({
  src,
  label,
  className,
  invert = true,
  plain = false,
  tint = false,
}: {
  src?: string;
  label: string;
  className?: string;
  invert?: boolean;
  /** Skip the tooltip root — used in collapsed row headers. */
  plain?: boolean;
  /** Draw in the text colour at full strength, to match the label beside it. */
  tint?: boolean;
}) {
  if (!src)
    return (
      <span
        className={cn("inline-block size-4 shrink-0", className)}
        aria-hidden
      />
    );
  if (tint) {
    const glyph = (
      <span
        role="img"
        aria-label={label}
        title={plain ? label : undefined}
        tabIndex={plain ? undefined : 0}
        className={cn("inline-block size-4 shrink-0 bg-current", className)}
        style={tintStyle(`${BUNGIE_IMAGE_BASE}${src}`)}
      />
    );
    return plain ? glyph : <TooltipLabel label={label}>{glyph}</TooltipLabel>;
  }
  const img = (
    // Tiny Bungie glyphs: skip next/image so collapsed rows don't pay optimizer + tooltip cost.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${BUNGIE_IMAGE_BASE}${src}`}
      alt={label}
      title={plain ? label : undefined}
      tabIndex={plain ? undefined : 0}
      width={16}
      height={16}
      decoding="async"
      className={cn(
        "inline-block size-4 shrink-0",
        invert && "invert dark:invert-0",
        className,
      )}
    />
  );
  if (plain) return img;
  return <TooltipLabel label={label}>{img}</TooltipLabel>;
}
