import { cn } from "@/lib/utils";

/** Armor-table filter chips — Figma Frame 226 uses 32px controls. */
export const fieldControlHeightClasses = "h-8 shrink-0 box-border";

/** Neutralize native button styles that can shrink triggers below the shell height. */
export const fieldControlTriggerResetClasses =
  "inline-flex appearance-none m-0 py-0 leading-none";

/** Transparent inner trigger that fills an outer field control shell. */
export const fieldControlInnerTriggerClasses = cn(
  fieldControlTriggerResetClasses,
  "h-full w-full min-h-0 cursor-pointer border-0 bg-transparent shadow-none outline-none",
  "items-center justify-between gap-1.5 pr-2.5 pl-3 text-sm whitespace-nowrap select-none",
);

/**
 * Filter trigger shell — Figma Frame 226: primary/lifted fill, input border,
 * emphatic fill when selected. Active stroke is the build-card fade
 * (foreground 24% at the top → 0% at the bottom), not a solid white outline.
 */
export const fieldFilterControlShellClasses = cn(
  fieldControlHeightClasses,
  "relative box-border overflow-hidden rounded-lg border border-input bg-foreground/6 transition-colors",
  "hover:bg-foreground/8 has-data-popup-open:border-emphatic focus-within:border-emphatic",
  "data-active:border-0 data-active:bg-emphatic data-active:text-emphatic-foreground data-active:shadow-none data-active:hover:bg-emphatic data-active:has-data-popup-open:border-0 data-active:focus-within:border-0",
);

/** Same top-lit rim as build cards, 24% so it reads on --emphatic. */
export const fieldFilterActiveEdgeClasses = cn(
  "before:pointer-events-none before:absolute before:inset-0 before:z-1 before:rounded-[inherit] before:content-['']",
  "before:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_24%,transparent)]",
  "before:[mask-image:linear-gradient(to_bottom,#000,#0000)] before:[-webkit-mask-image:linear-gradient(to_bottom,#000,#0000)]",
);
