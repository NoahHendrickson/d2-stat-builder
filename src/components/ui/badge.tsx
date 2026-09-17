"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** Small tags — "2PC", "Artifice", "Missing". Classic: rounded pills; D2: 4px uppercase plates. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3! d2:rounded-[4px] d2:px-1.5 d2:text-[10px] d2:tracking-label d2:uppercase d2:transition-colors d2:focus-visible:border-outline-strong d2:focus-visible:ring-0 d2:has-data-[icon=inline-end]:pr-1 d2:has-data-[icon=inline-start]:pl-1",
  {
    variants: {
      variant: {
        default:
          "border-primary-border bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        emphatic:
          "bg-emphatic text-emphatic-foreground [a]:hover:bg-emphatic-dark d2:border-white/24 d2:[a]:hover:bg-emphatic-light",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20 d2:border-destructive/40 d2:bg-destructive/15 d2:dark:bg-destructive/15 d2:[a]:hover:bg-destructive/25",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground d2:border-foreground/25 d2:[a]:hover:bg-transparent d2:[a]:hover:text-foreground d2:[a]:hover:border-outline-strong",
        exotic:
          "border-exotic-line/70 bg-exotic/15 text-exotic-line",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline d2:normal-case d2:tracking-normal",
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
