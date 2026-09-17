import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 d2-line d2:rounded-none d2:bg-lifted d2:dark:bg-lifted d2:transition-[background-color] hover:[--line-alpha:1.6] focus-visible:[--line-alpha:2.6] focus-visible:d2-line-drift d2:focus-visible:ring-0 d2:disabled:bg-transparent d2:dark:disabled:bg-transparent d2:disabled:opacity-40 d2:aria-invalid:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
