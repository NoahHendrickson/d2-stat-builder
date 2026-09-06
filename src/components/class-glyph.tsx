import type { SVGProps } from "react";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { cn } from "@/lib/utils";

/**
 * Destiny class sigils, keyed by DestinyClass (0 Titan, 1 Hunter, 2 Warlock).
 * Geometry is the Figma export (frames 95 / 96 / 97 of the "Your armor" card);
 * the fill is `currentColor` so the glyph follows the surrounding text colour.
 */
const GLYPHS: Record<number, { viewBox: string; width: number; d: string }> = {
  0: {
    viewBox: "0 0 8 16",
    width: 8,
    d: "M2.07844 6.6115L4 6.60575L2.07761 9.2185L4 9.2125L1.94923 12H0L1.94674 9.393H0L1.94563 6.7875H0L2.07706 4.006L4 4L2.07844 6.6115ZM5.92156 6.6115L4 4L5.92294 4.006L8 6.7875H6.05437L8 9.393H6.05326L8 12H6.05077L4 9.2125L5.92239 9.2185L4 6.60575L5.92156 6.6115Z",
  },
  1: {
    viewBox: "0 0 10 16",
    width: 10,
    d: "M4.59516 7.99212L0 5.13875V10.8455L4.59516 7.99212ZM5.40484 7.99212L10 10.8455V5.13875L5.40484 7.99212ZM7.31746 3.4265L5.01988 2L0.424716 4.85338L5.01988 7.70675L9.61538 4.85338L7.31746 3.4265ZM7.31746 9.7205L5.01988 8.29363L0.424716 11.147L5.01988 14L9.61538 11.147L7.31746 9.7205Z",
  },
  2: {
    viewBox: "0 0 12 16",
    width: 12,
    d: "M2.04075 11L4.76137 6.62359L3.74513 5L0 11H2.04075ZM4.2855 11L5.8905 8.42712L4.87162 6.7994L2.24962 11H4.2855ZM7.22175 6.63824L9.96525 11H12L8.24438 5L7.22175 6.63824ZM4.49925 11H7.50075L5.99775 8.5988L4.49925 11ZM7.12088 6.7994L6.10725 8.42374L7.7205 11H9.75037L7.12088 6.7994ZM4.98075 6.62697L5.997 5L7.01325 6.62697L5.99962 8.25207L4.98075 6.62697Z",
  },
};

export function ClassGlyph({
  classType,
  className,
  ...props
}: { classType: number } & Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">) {
  const glyph = GLYPHS[classType];
  if (!glyph) return null;
  return (
    <svg
      viewBox={glyph.viewBox}
      width={glyph.width}
      height={16}
      role="img"
      aria-label={CLASS_NAMES[classType]}
      className={cn("h-4 shrink-0", className)}
      {...props}
    >
      <title>{CLASS_NAMES[classType]}</title>
      <path d={glyph.d} fill="currentColor" />
    </svg>
  );
}
