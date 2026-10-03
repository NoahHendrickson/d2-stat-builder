"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * Figma "Select Trigger" 69:867: 32px, square, lifted fill, the app's centre-bright line, which brightens on focus.
 * The browser's own search-field X is hidden; search fields pair with `SearchClearButton` instead.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "d2-line h-8 w-full min-w-0 rounded-none normal:rounded-[10px] bg-lifted px-2.5 py-1 text-base transition-[background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:[--line-alpha:1.6] focus-visible:[--line-alpha:2.6] focus-visible:d2-line-drift disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive md:text-sm [&::-webkit-search-cancel-button]:hidden",
        className
      )}
      {...props}
    />
  )
}

/** The clear-search X, pinned inside the right edge of a `relative` wrapper around a search Input (give the Input `pr-8`). */
function SearchClearButton({ className, ...props }: Omit<React.ComponentProps<"button">, "children">) {
  return (
    <button
      type="button"
      aria-label="Clear search"
      className={cn(
        "text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-none normal:rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-outline-strong",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
    </button>
  )
}

export { Input, SearchClearButton }
