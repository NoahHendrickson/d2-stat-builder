"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Square toggle: off is a lifted well with the app's centre-bright line; on
 * fills EQUIP green (see globals.css checked rule) with a white thumb. Sizes:
 * default 36×20 (16px thumb), sm 28×16 (12px thumb) — 1px border + 1px padding
 * each side, so the thumb travels track − thumb − 4.
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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-none p-px d2-line d2-hover-ring bg-lifted transition-[background-color,border-color,color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 hover:[--line-alpha:1.6] hover:not-data-checked:bg-foreground/8 focus-visible:[--line-alpha:2.6] aria-invalid:border-destructive data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-none transition-[translate,background-color] group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-checked:bg-white data-unchecked:bg-foreground/50 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
