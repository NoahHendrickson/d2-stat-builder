import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full border border-foreground/15 rounded-none normal:rounded-[10px] bg-lifted px-2.5 py-2 text-base transition-[background-color,border-color] outline-none placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
