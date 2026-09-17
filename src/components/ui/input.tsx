"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/** Text field. Classic: 36px rounded, emphatic border on focus. D2 (Figma "Select Trigger" 69:867): 32px, square, lifted fill, the centre-bright line, which brightens on focus. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-emphatic disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 d2-line d2:h-8 d2:rounded-none d2:bg-lifted d2:dark:bg-lifted d2:transition-[background-color] hover:[--line-alpha:1.6] focus-visible:[--line-alpha:2.6] focus-visible:d2-line-drift d2:disabled:bg-transparent d2:dark:disabled:bg-transparent d2:disabled:opacity-40 d2:aria-invalid:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Input }
