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
  "d2-line relative box-border overflow-hidden rounded-none bg-lifted transition-colors",
  "hover:[--line-alpha:1.6] has-data-popup-open:[--line-alpha:2.6] focus-within:[--line-alpha:2.6]",
  "data-active:[border-image:none] data-active:border-white/70 data-active:bg-brand data-active:text-white data-active:shadow-[0_0_2px_1px_rgb(25_25_25/0.4)] data-active:hover:bg-brand data-active:has-data-popup-open:border-white data-active:focus-within:border-white",
);

/** Active filter chips are a plain white plate; no extra rim. */
export const fieldFilterActiveEdgeClasses = "";
