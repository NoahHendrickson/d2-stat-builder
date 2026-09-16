"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckboxCheckIcon } from "@/components/ui/checkbox-check-icon"

/** 4px selection box: hairline frame on a lifted well, white plate with a dark check when on. */
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
        "peer group/checkbox relative flex shrink-0 items-center justify-center rounded-[4px] border border-input bg-lifted transition-colors outline-none group-has-disabled/field:opacity-40 after:absolute after:-inset-x-3 after:-inset-y-2 hover:border-foreground/40 focus-visible:border-outline-strong focus-visible:shadow-[0_0_0_1px_var(--outline-strong)] disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive data-[size=default]:size-4 data-[size=lg]:size-5",
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
