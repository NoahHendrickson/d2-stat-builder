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
 * Filter trigger shell — Figma Frame 226. Classic: rounded, input border,
 * emphatic fill when selected with the build-card fade as its stroke. D2:
 * square, lifted fill under the centre-bright line, brand blue when selected.
 */
export const fieldFilterControlShellClasses = cn(
  fieldControlHeightClasses,
  "d2-line relative box-border overflow-hidden rounded-lg border border-input bg-foreground/6 transition-colors d2:rounded-none d2:bg-lifted",
  "hover:bg-foreground/8 has-data-popup-open:border-emphatic focus-within:border-emphatic hover:[--line-alpha:1.6] has-data-popup-open:[--line-alpha:2.6] focus-within:[--line-alpha:2.6] d2:hover:bg-lifted",
  "data-active:border-0 data-active:bg-emphatic data-active:text-emphatic-foreground data-active:shadow-none data-active:hover:bg-emphatic data-active:has-data-popup-open:border-0 data-active:focus-within:border-0",
  "d2:data-active:[border-image:none] d2:data-active:border d2:data-active:border-white/70 d2:data-active:bg-brand d2:data-active:text-white d2:data-active:shadow-[0_0_2px_1px_rgb(25_25_25/0.4)] d2:data-active:hover:bg-brand d2:data-active:has-data-popup-open:border d2:data-active:has-data-popup-open:border-white d2:data-active:focus-within:border d2:data-active:focus-within:border-white",
);

/**
 * Classic: the same top-lit rim as build cards, 24% so it reads on --emphatic.
 * D2: active chips are a plain plate with no extra rim.
 */
export const fieldFilterActiveEdgeClasses = cn(
  "classic:before:pointer-events-none classic:before:absolute classic:before:inset-0 classic:before:z-1 classic:before:rounded-[inherit] classic:before:content-['']",
  "classic:before:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_24%,transparent)]",
  "classic:before:[mask-image:linear-gradient(to_bottom,#000,#0000)] classic:before:[-webkit-mask-image:linear-gradient(to_bottom,#000,#0000)]",
);
