"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Buttons per the Figma sidebar (69:863): square, sentence-case controls that
 * match the fields — `default` is the lifted chip with the app's centre-bright
 * line (`d2-line`), `outline` the same without the fill, `dashed` the dashed-frame square icon well beside
 * a loadout — `ghost` is the 10px hover pill used for icon buttons, and the
 * one loud element is `emphatic`: the square, uppercase, display-face green
 * EQUIP with its white/24 line.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] outline-none select-none focus-visible:[--line-alpha:2.6] focus-visible:border-outline-strong active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "d2-line d2-hover-ring bg-lifted text-foreground hover:[--line-alpha:1.6] hover:bg-foreground/8 aria-expanded:[--line-alpha:1.6] aria-expanded:bg-foreground/8",
        outline:
          "d2-line d2-hover-ring bg-transparent text-foreground hover:[--line-alpha:1.6] hover:bg-foreground/6 aria-expanded:[--line-alpha:1.6] aria-expanded:bg-foreground/6",
        emphatic:
          // Figma 69:1430: green with the centre-bright gradient line (d2-equip),
          // 12px uppercase EQUIP label in Geist, with the centre-bright line.
          "d2-heading d2-equip d2-hover-ring rounded-none text-xs tracking-[0.02em] text-emphatic-foreground hover:[--equip-fill:var(--emphatic-light)] hover:d2-line-drift aria-expanded:[--equip-fill:var(--emphatic-light)]",
        ghost:
          "rounded-[10px] border-transparent text-foreground hover:bg-foreground/8 aria-expanded:bg-foreground/8",
        dashed:
          // Figma 69:883: faint white/16 frame with corner ticks over the white/4 fill, no shadow.
          "d2-corner-well d2-hover-ring rounded-none text-foreground hover:[--tick-alpha:60%] hover:[--lifted:color-mix(in_srgb,var(--foreground)_8%,transparent)] aria-expanded:[--tick-alpha:60%] aria-expanded:[--lifted:color-mix(in_srgb,var(--foreground)_8%,transparent)]",
        destructive:
          "d2-hover-ring border-destructive/40 bg-destructive/10 text-destructive hover:border-destructive/70 hover:bg-destructive/20 focus-visible:border-destructive",
        link: "border-transparent text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
