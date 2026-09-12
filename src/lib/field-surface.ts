import { cn } from "@/lib/utils";

/** Matches Input / SelectTrigger height after the optimizer restyle. */
export const fieldControlHeightClasses = "h-9 shrink-0 box-border";

/** Neutralize native button styles that can shrink triggers below the shell height. */
export const fieldControlTriggerResetClasses =
  "inline-flex appearance-none m-0 py-0 leading-none";

/** Transparent inner trigger that fills an outer field control shell. */
export const fieldControlInnerTriggerClasses = cn(
  fieldControlTriggerResetClasses,
  "h-full w-full min-h-0 cursor-pointer border-0 bg-transparent shadow-none outline-none",
  "items-center justify-between gap-1.5 pr-2 pl-2.5 text-sm whitespace-nowrap select-none",
);

/**
 * Filter trigger shell — same flat Input / Select recipe as the optimizer
 * (rounded-lg, border-input, emphatic focus / open / active).
 */
export const fieldFilterControlShellClasses = cn(
  fieldControlHeightClasses,
  "relative box-border rounded-lg border border-input bg-transparent transition-colors",
  "hover:bg-muted/60 has-data-popup-open:border-emphatic focus-within:border-emphatic",
  "data-active:border-emphatic dark:bg-input/30 dark:hover:bg-input/50",
);
