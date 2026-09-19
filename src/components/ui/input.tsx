"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/** Figma "Select Trigger" 69:867: 32px, square, lifted fill, the app's centre-bright line, which brightens on focus. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "d2-line h-8 w-full min-w-0 rounded-none bg-lifted px-2.5 py-1 text-base transition-[background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:[--line-alpha:1.6] focus-visible:[--line-alpha:2.6] focus-visible:d2-line-drift disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
