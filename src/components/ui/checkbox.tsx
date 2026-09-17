"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckboxCheckIcon } from "@/components/ui/checkbox-check-icon"

/** Selection box. Classic: 4px rounded, blue when checked. D2: square, default-button line and hover ring, EQUIP green when checked. */
function Checkbox({
  className,
  size = "default",
  ...props
}: CheckboxPrimitive.Root.Props & {
  size?: "default" | "lg"
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      className={cn(
        "peer group/checkbox relative flex shrink-0 items-center justify-center border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-foreground data-[size=default]:size-4 data-[size=default]:rounded-[4px] data-[size=lg]:size-5 data-[size=lg]:rounded-[5px] dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:text-emphatic-foreground d2-line d2-hover-ring d2:bg-lifted d2:dark:bg-lifted d2:transition-[background-color,border-color,color,box-shadow] d2:group-has-disabled/field:opacity-40 hover:[--line-alpha:1.6] d2:hover:not-data-checked:bg-foreground/8 focus-visible:[--line-alpha:2.6] d2:focus-visible:ring-0 d2:disabled:opacity-40 d2:aria-invalid:ring-0 d2:data-[size=default]:rounded-none d2:data-[size=lg]:rounded-none",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckboxCheckIcon className="group-data-[size=lg]/checkbox:size-5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
