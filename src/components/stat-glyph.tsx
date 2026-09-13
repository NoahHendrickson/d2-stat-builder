"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { cn } from "@/lib/utils";

/** A 16px Bungie stat (or plug) icon with a tooltip, or an empty square without `src`. */
export function StatGlyph({
  src,
  label,
  className,
  invert = true,
  plain = false,
}: {
  src?: string;
  label: string;
  className?: string;
  invert?: boolean;
  /** Skip the tooltip root — used in collapsed row headers. */
  plain?: boolean;
}) {
  if (!src)
    return (
      <span
        className={cn("inline-block size-4 shrink-0", className)}
        aria-hidden
      />
    );
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
