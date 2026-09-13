/** Darken the Stasis plate (white glyph stays white) before the hue swap. */
export const STRAND_ABILITY_PLATE_FILTER = "url(#strand-ability-plate)";

/**
 * Strand class abilities and jumps reuse Stasis icon files. Recolor to the
 * darker melee/grenade green: gamma on the image, then mix-blend-color.
 * Parent must be `relative isolate`.
 */
export function StrandAbilityRecolor({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <>
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
        <filter id="strand-ability-plate" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude="1" exponent="1.8" offset="0" />
            <feFuncG type="gamma" amplitude="1" exponent="1.8" offset="0" />
            <feFuncB type="gamma" amplitude="1" exponent="1.8" offset="0" />
          </feComponentTransfer>
        </filter>
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[hsl(137_48%_28%)] mix-blend-color"
      />
    </>
  );
}
