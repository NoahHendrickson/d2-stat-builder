"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Buttons. Classic classes are bare; the D2 skin's sit under `d2:` or the
 * self-gated `d2-*` utilities (see globals.css).
 *
 * Classic: 10px rounded pills — `default` solid primary, `outline` a faint
 * primary border, `emphatic` the blue Figma CTA, `ghost` a hover wash.
 * D2 (Figma sidebar 69:863): square, sentence-case controls that match the
 * fields — `default` is the lifted chip with the centre-bright line
 * (`d2-line`), `outline` the same without the fill, `dashed` the corner-tick
 * icon well beside a loadout, `ghost` the 10px hover pill for icon buttons,
 * and the one loud element is `emphatic`: the square, uppercase green EQUIP
 * with its white/24 line.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[10px] corner-smooth border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 d2:rounded-none d2:transition-[background-color,border-color,color,box-shadow] d2:focus-visible:[--line-alpha:2.6] d2:focus-visible:border-outline-strong d2:focus-visible:ring-0 d2:disabled:opacity-40 d2:aria-invalid:ring-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80 d2-line d2-hover-ring d2:bg-lifted d2:text-foreground hover:[--line-alpha:1.6] d2:hover:bg-foreground/8 aria-expanded:[--line-alpha:1.6] d2:aria-expanded:bg-foreground/8",
        outline:
          "border-primary/20 text-primary hover:bg-primary/5 aria-expanded:bg-primary/5 d2-line d2-hover-ring d2:text-foreground hover:[--line-alpha:1.6] d2:hover:bg-foreground/6 aria-expanded:[--line-alpha:1.6] d2:aria-expanded:bg-foreground/6",
        emphatic:
          // Figma 69:1430: green with the centre-bright gradient line (d2-equip),
          // 12px uppercase EQUIP label in Geist, with the centre-bright line.
          "bg-emphatic text-emphatic-foreground hover:bg-emphatic-dark aria-expanded:bg-emphatic-dark d2-heading d2-equip d2-hover-ring d2:text-xs d2:tracking-[0.02em] hover:[--equip-fill:var(--emphatic-light)] hover:d2-line-drift aria-expanded:[--equip-fill:var(--emphatic-light)]",
        ghost:
          "text-primary hover:bg-primary/5 aria-expanded:bg-primary/5 d2:rounded-[10px] d2:text-foreground d2:hover:bg-foreground/8 d2:aria-expanded:bg-foreground/8",
        dashed:
          // Figma 69:883: faint white/16 frame with corner ticks over the white/4 fill, no shadow.
          "border-dashed border-primary/30 text-primary hover:bg-primary/5 aria-expanded:bg-primary/5 d2-corner-well d2-hover-ring d2:border-solid d2:text-foreground hover:[--tick-alpha:60%] hover:[--lifted:rgb(255_255_255/8%)] aria-expanded:[--tick-alpha:60%] aria-expanded:[--lifted:rgb(255_255_255/8%)]",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40 d2-hover-ring d2:border-destructive/40 d2:hover:border-destructive/70 d2:focus-visible:border-destructive d2:dark:bg-destructive/10 d2:dark:hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline d2:text-foreground",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 d2:h-10 d2:gap-2 d2:px-4 d2:has-data-[icon=inline-end]:pr-3 d2:has-data-[icon=inline-start]:pl-3",
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
