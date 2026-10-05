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

/** Filter trigger shell — Figma Frame 226. Add the idle or active classes below. */
export const fieldFilterControlShellClasses = cn(
  fieldControlHeightClasses,
  "relative box-border overflow-hidden rounded-none normal:rounded-[10px] transition-colors",
);

/** No filter set: lifted fill and the field line, brighter on hover / while open. */
export const fieldFilterIdleClasses =
  "d2-line bg-lifted hover:[--line-alpha:1.6] has-data-popup-open:[--line-alpha:2.6] focus-within:[--line-alpha:2.6]";

/**
 * A filter set: the EQUIP button — green under the Bungie gradient line (kept under
 * plain lines), lighter green on hover or while open. Never alongside d2-line, whose
 * border-image would cover the line.
 */
export const fieldFilterActiveEdgeClasses =
  "d2-equip text-white hover:[--equip-fill:var(--emphatic-light)] has-data-popup-open:[--equip-fill:var(--emphatic-light)]";
