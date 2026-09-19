"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** Small 4px tags in the display face — "2PC", "ARTIFICE", "MISSING". */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[4px] border px-1.5 py-0.5 font-display text-[10px] font-medium tracking-label uppercase whitespace-nowrap transition-colors focus-visible:border-outline-strong has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "border-primary-border bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        emphatic:
          "border-white/24 bg-emphatic text-emphatic-foreground [a]:hover:bg-emphatic-light",
        destructive:
          "border-destructive/40 bg-destructive/15 text-destructive [a]:hover:bg-destructive/25",
        outline:
          "border-foreground/25 text-foreground [a]:hover:border-outline-strong",
        exotic:
          "border-exotic-line/70 bg-exotic/15 text-exotic-line",
        ghost:
          "border-transparent hover:bg-muted hover:text-muted-foreground",
        link: "border-transparent font-sans normal-case tracking-normal text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
