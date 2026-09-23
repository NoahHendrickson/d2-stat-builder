"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Square toggle (Figma 98:1855, at control size). Off is a foreground/16 well;
 * on fills the greeny gradient (same stops as the slider range). Default is
 * 36×20 with a 16px frosted thumb; sm is 28×16 with a 12px thumb.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-none border border-foreground/16 bg-foreground/16 p-px outline-none transition-[background-color,border-color,box-shadow] after:absolute after:-inset-x-3 after:-inset-y-2 hover:not-data-checked:bg-foreground/20 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-outline-strong d2-hover-ring aria-invalid:border-destructive data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:d2-fill data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-none border border-white/16 bg-white/40 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
