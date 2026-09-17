"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckboxCheckIcon } from "@/components/ui/checkbox-check-icon"

/** Square selection box: default-button line and hover ring; EQUIP green when checked. */
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
        "peer group/checkbox relative flex shrink-0 items-center justify-center rounded-none d2-line d2-hover-ring bg-lifted transition-[background-color,border-color,color,box-shadow] outline-none group-has-disabled/field:opacity-40 after:absolute after:-inset-x-3 after:-inset-y-2 hover:[--line-alpha:1.6] hover:not-data-checked:bg-foreground/8 focus-visible:[--line-alpha:2.6] disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive data-[size=default]:size-4 data-[size=lg]:size-5",
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
