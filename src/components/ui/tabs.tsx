"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-3 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  children,
  ...props
}: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      // Accent-filled track; extra bottom room so the selected indicator's hard
      // shadow sits inside the container.
      className={cn(
        "relative inline-flex w-fit items-center rounded-xl bg-accent px-0.5 pt-0.5 pb-[5px] text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
        className
      )}
      {...props}
    >
      {/* The selected 3D "button" — slides/resizes between tabs. Base UI keeps
          --active-tab-* in sync with the active tab. */}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        className="absolute top-[var(--active-tab-top)] left-[var(--active-tab-left)] z-0 h-[var(--active-tab-height)] w-[var(--active-tab-width)] rounded-lg border border-brand bg-background shadow-[0_3px_0_0_var(--brand-shadow)] transition-[top,left,width,height] duration-200 ease-out"
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      // Label above the sliding indicator (z-10). Selected text turns to
      // foreground; the 3D button visual comes from the indicator.
      className={cn(
        "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 py-1 text-sm font-semibold whitespace-nowrap text-foreground/60 transition-colors outline-none select-none",
        "hover:text-foreground",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        "data-active:text-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
