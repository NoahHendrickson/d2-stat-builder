export const fieldControlHeightClasses = "h-8 shrink-0 box-border";

export const field3dSurfaceClasses =
  "relative isolate before:absolute before:-inset-x-px before:-top-px before:-bottom-[5px] before:z-[-2] before:rounded-[6px] before:border before:border-[var(--neutral-line)] before:bg-[var(--neutral-shadow)] before:content-[''] after:absolute after:-inset-px after:z-[-1] after:rounded-[6px] after:border after:border-[var(--neutral-line)] after:bg-background after:transition-colors after:content-[''] hover:after:bg-muted"

// Focus targets ::after (the face border) — no ring glow, just brand blue on focus.
export const field3dFocusClasses =
  "outline-none focus-within:after:border-brand"

// Select: focus-visible for keyboard; data-popup-open while the listbox is open
// (focus leaves the trigger, so focus-visible alone wouldn't keep the border).
export const field3dFocusVisibleClasses =
  "outline-none focus-visible:after:border-brand data-popup-open:after:border-brand"

export const field3dInvalidClasses =
  "aria-invalid:before:border-destructive aria-invalid:after:border-destructive dark:aria-invalid:after:border-destructive/50"

export const field3dInvalidHasClasses =
  "has-aria-invalid:before:border-destructive has-aria-invalid:after:border-destructive dark:has-aria-invalid:after:border-destructive/50"

export const field3dInteractiveClasses =
  "transition-all active:translate-y-1 active:before:-bottom-[2px]"

export const field3dDisabledClasses =
  "has-disabled:pointer-events-none has-disabled:opacity-50 has-disabled:after:bg-input/50"
