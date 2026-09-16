"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * A soft 4px toggle: off is a lifted well with a hairline frame; on fills the
 * track EQUIP green with a white thumb. Sizes: default 36×20 (16px thumb),
 * sm 28×16 (12px thumb) — 1px border + 1px padding each side, so the thumb
 * travels track − thumb − 4.
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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-[4px] border p-px transition-[background-color,border-color] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-outline-strong focus-visible:shadow-[0_0_0_1px_var(--outline-strong)] aria-invalid:border-destructive data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:border-white/24 data-checked:bg-emphatic data-unchecked:border-input data-unchecked:bg-lifted hover:data-unchecked:border-foreground/35 data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-[2px] transition-[translate,background-color] group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-checked:bg-white data-unchecked:bg-foreground/50 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
