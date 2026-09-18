import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full d2-line rounded-none bg-lifted px-2.5 py-2 text-base transition-[background-color] outline-none placeholder:text-muted-foreground hover:[--line-alpha:1.6] focus-visible:[--line-alpha:2.6] focus-visible:d2-line-drift disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
