"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Check } from "@phosphor-icons/react"

const checkboxVariants = cva(
  "peer group/checkbox relative flex shrink-0 items-center justify-center border border-input outline-none transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.92] active:duration-100 motion-reduce:transition-none motion-reduce:active:scale-100 group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-brand data-checked:bg-background data-checked:text-primary dark:data-checked:bg-background data-checked:before:absolute data-checked:before:-inset-x-px data-checked:before:-top-px data-checked:before:border data-checked:before:border-brand data-checked:before:bg-[var(--brand-shadow)] data-checked:before:transition-[bottom] data-checked:before:duration-150 data-checked:before:ease-out data-checked:before:content-['']",
  {
    variants: {
      size: {
        default:
          "size-4 rounded-[4px] data-checked:before:-bottom-[3px] data-checked:before:rounded-[4px]",
        lg: "size-5 rounded-[5px] data-checked:before:-bottom-[4px] data-checked:before:rounded-[5px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const checkboxIndicatorVariants = cva(
  "absolute -inset-px grid origin-center place-content-center border border-brand bg-background text-current transition-[opacity,transform] duration-150 ease-out data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:scale-90 data-ending-style:opacity-0 motion-reduce:transition-none motion-reduce:data-starting-style:scale-100 motion-reduce:data-starting-style:opacity-100 motion-reduce:data-ending-style:scale-100 motion-reduce:data-ending-style:opacity-100 group-focus-visible/checkbox:border-ring group-aria-invalid/checkbox:border-primary",
  {
    variants: {
      size: {
        default: "rounded-[4px] [&>svg]:size-3.5",
        lg: "rounded-[5px] [&>svg]:size-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Checkbox({
  className,
  size = "default",
  ...props
}: CheckboxPrimitive.Root.Props & VariantProps<typeof checkboxVariants>) {
  return (
    // Checked = the dolores-ds 3D button treatment: a light bg-background face
    // with a brand-blue border on a brand-shadow "lip". Same recipe as Button's
    // default variant, scaled to the 16px box — ~2px lip, 4px radius — with a
    // primary-blue check. Unchecked stays a plain neutral outline, no lip.
    //
    // Layering (same fix as Button): the lip ::before must NOT use a negative
    // z-index — negative-z pseudos get painted behind any opaque ancestor
    // background (a Card's bg-card, a Dialog popup), which silently flattened
    // the checked box. Instead everything stacks in tree order: root face →
    // lip ::before (paints above the root's own bg) → Indicator, restyled as an
    // absolutely-positioned copy of the face that covers the lip's top + sides
    // so only the bottom pokes out. The Indicator only mounts when checked,
    // which is exactly when the face needs repainting over the lip. ::after
    // stays reserved for the expanded hit area.
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      className={cn(checkboxVariants({ size, className }))}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={checkboxIndicatorVariants({ size })}
      >
        <Check />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox, checkboxVariants }
