"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import {
  field3dDisabledClasses,
  field3dFocusClasses,
  field3dInvalidHasClasses,
  field3dSurfaceClasses,
} from "@/lib/field-surface"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <div
      className={cn(
        "w-full",
        field3dSurfaceClasses,
        field3dFocusClasses,
        field3dInvalidHasClasses,
        field3dDisabledClasses,
        className
      )}
    >
      <InputPrimitive
        type={type}
        data-slot="input"
        className="relative z-0 h-8 w-full min-w-0 rounded-[6px] border-0 bg-transparent px-2.5 py-1 text-base outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
        {...props}
      />
    </div>
  )
}

export { Input }
