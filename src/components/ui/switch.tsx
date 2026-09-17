"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Toggle. Classic: a rounded pill, primary when on. D2: a square well with
 * the centre-bright line; on fills EQUIP green (see globals.css checked rule)
 * with a white thumb. D2 sizes: default 36×20 (16px thumb), sm 28×16 (12px
 * thumb) — 1px border + 1px padding each side, so the thumb travels
 * track − thumb − 4.
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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary-border data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50 d2-line d2-hover-ring d2:rounded-none d2:p-px d2:transition-[background-color,border-color,color,box-shadow] hover:[--line-alpha:1.6] d2:hover:not-data-checked:bg-foreground/8 focus-visible:[--line-alpha:2.6] d2:focus-visible:ring-0 d2:aria-invalid:ring-0 d2:data-[size=default]:h-5 d2:data-[size=default]:w-9 d2:data-[size=sm]:h-4 d2:data-[size=sm]:w-7 d2:data-checked:border-transparent d2:data-unchecked:bg-lifted d2:dark:data-unchecked:bg-lifted d2:data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground d2:rounded-none d2:transition-[translate,background-color] d2:data-checked:bg-white d2:dark:data-checked:bg-white d2:data-unchecked:bg-foreground/50 d2:dark:data-unchecked:bg-foreground/50 d2:group-data-[size=default]/switch:data-checked:translate-x-4 d2:group-data-[size=sm]/switch:data-checked:translate-x-3"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
