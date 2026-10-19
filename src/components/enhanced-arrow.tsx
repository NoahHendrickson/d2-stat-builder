import { useId, type SVGProps } from "react";

/**
 * The enhanced-perk arrow: a solid head over a stem with solid edges and a fill
 * that fades out. Used on perk icons (sized and pinned by the caller) and inline
 * in perk tooltips. The fill is `currentColor`, so callers set the gold.
 */
export function EnhancedArrow(
  props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">,
) {
  const fade = useId();
  return (
    <svg viewBox="0 0 10 10" aria-hidden fill="currentColor" {...props}>
      <defs>
        <linearGradient id={fade} x1="0" y1="5" x2="0" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M5 0L9.65 5H0.35L5 0Z" />
      <rect x="3.08" y="5" width="3.84" height="5" fill={`url(#${fade})`} />
      <rect x="3.08" y="5" width="0.45" height="5" />
      <rect x="6.47" y="5" width="0.45" height="5" />
    </svg>
  );
}
