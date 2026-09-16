"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

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
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * Tab strips. `default` is a lifted track whose active cell is a raised
 * plate; `icon` is the square two-way icon switch (optimizer / table);
 * `line` is text on a hairline with a white underline under the active item.
 */
const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default:
          "group-data-horizontal/tabs:h-8 overflow-clip rounded-md border border-input bg-lifted p-0.5",
        icon: "h-8 rounded-none d2-line bg-lifted hover:[--line-alpha:1.6]",
        line: "group-data-horizontal/tabs:h-8 gap-4 rounded-none border-b border-foreground/12 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const tabsIndicatorVariants = cva(
  "pointer-events-none absolute top-0 left-0 z-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) transition-[translate,width,height] duration-200 ease-out motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "rounded-[4px] bg-foreground/12 shadow-[0_1px_2px_rgb(0_0_0/0.25)]",
        icon: "rounded-none bg-foreground/12",
        line: "bg-foreground group-data-horizontal/tabs:top-[calc(var(--active-tab-top)+var(--active-tab-height)-2px)] group-data-horizontal/tabs:h-0.5 group-data-horizontal/tabs:translate-y-0 group-data-vertical/tabs:left-[calc(var(--active-tab-left)+var(--active-tab-width)-2px)] group-data-vertical/tabs:w-0.5 group-data-vertical/tabs:translate-x-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        className={tabsIndicatorVariants({ variant })}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-transparent text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-outline-strong disabled:pointer-events-none disabled:opacity-40 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-40 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // default variant: full-height cell inside the padded track
        "group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:min-w-9 group-data-[variant=default]/tabs-list:px-3",
        // icon variant: 32×32 square, no label padding
        "group-data-[variant=icon]/tabs-list:size-8 group-data-[variant=icon]/tabs-list:flex-none group-data-[variant=icon]/tabs-list:rounded-none group-data-[variant=icon]/tabs-list:px-0 group-data-[variant=icon]/tabs-list:justify-center",
        // line variant: text on the rule; the underline is the sliding indicator
        "group-data-[variant=line]/tabs-list:h-full group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:px-0.5 group-data-[variant=line]/tabs-list:pb-0.5 group-data-[variant=line]/tabs-list:text-sm",
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

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
