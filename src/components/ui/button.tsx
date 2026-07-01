"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[6px] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The dolores-ds 3D button (Figma node 104:216) is a white face sitting on
        // a 4px bordered lip (the "double border"). Both the face (::after) and the
        // lip (::before) are REAL bordered pseudo-elements, so their 1px borders
        // follow the 6px corner radius at UNIFORM width. A box-shadow "lip" can't:
        // it's an offset duplicate, and offsetting a rounded rect pinches the
        // border to nothing as it wraps the corner. The button is `relative
        // isolate`: `relative` is the containing block that SIZES the absolute
        // pseudos (without it they balloon out to fill a distant positioned
        // ancestor), and `isolate` gives the button its own stacking context so
        // these negative-z pseudos are contained — they sit behind the face yet
        // can't be painted behind an opaque
        // ancestor background (a Card's bg-card / bg-muted footer), which is what
        // made a plain negative-z ::before silently vanish inside cards/dialogs.
        // The face (::after, -inset-px = border box) covers the lip's top + sides
        // so only the bottom pokes out; on press the whole button drops 4px
        // (translate-y-1) and the lip shrinks to a 2px sliver — still 3D, pressed in.
        default:
          "relative isolate font-semibold text-foreground active:translate-y-1 before:absolute before:-inset-x-px before:-top-px before:-bottom-[5px] before:z-[-2] before:rounded-[6px] before:border before:border-brand before:bg-[var(--brand-shadow)] before:content-[''] active:before:-bottom-[2px] after:absolute after:-inset-px after:z-[-1] after:rounded-[6px] after:border after:border-brand after:bg-background after:transition-colors after:content-[''] hover:after:bg-accent focus-visible:after:border-ring",
        outline:
          "relative isolate font-semibold text-foreground active:translate-y-1 before:absolute before:-inset-x-px before:-top-px before:-bottom-[5px] before:z-[-2] before:rounded-[6px] before:border before:border-[var(--neutral-line)] before:bg-[var(--neutral-shadow)] before:content-[''] active:before:-bottom-[2px] after:absolute after:-inset-px after:z-[-1] after:rounded-[6px] after:border after:border-[var(--neutral-line)] after:bg-background after:transition-colors after:content-[''] hover:after:bg-muted focus-visible:after:border-ring",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
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
