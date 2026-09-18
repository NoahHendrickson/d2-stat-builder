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

/** Figma 77:1640 well: square frame, faint fill, EQUIP plate under the active cell. */
const wellTrack = "rounded-none border border-foreground/16 bg-primary/6 p-0.5"
const wellPlate =
  "rounded-none d2-equip group-has-[[data-active]:hover]/tabs-list:[--equip-fill:var(--emphatic-light)] group-has-[[data-active]:hover]/tabs-list:d2-line-drift"

/**
 * Tab strips. `default` is labelled cells in the 77:1640 well (fragments);
 * `icon` is 32×32 cells in the same well (optimizer / table, major mods);
 * `line` is text on a hairline with a white underline under the active item.
 */
const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: wellTrack,
        // 2px pad + 1px line around two 32px cells (70×38).
        icon: wellTrack,
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
        default: wellPlate,
        // EQUIP plate slides under the icons; hover lightens like the CTA.
        icon: wellPlate,
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
        "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-none border border-transparent text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-outline-strong disabled:pointer-events-none disabled:opacity-40 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-40 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // default variant: labelled cell in the well; the green plate is the sliding indicator
        "group-data-[variant=default]/tabs-list:h-8 group-data-[variant=default]/tabs-list:min-w-8 group-data-[variant=default]/tabs-list:flex-none group-data-[variant=default]/tabs-list:border-0 group-data-[variant=default]/tabs-list:bg-transparent group-data-[variant=default]/tabs-list:px-2.5 group-data-[variant=default]/tabs-list:text-foreground/50 group-data-[variant=default]/tabs-list:transition-[color] group-data-[variant=default]/tabs-list:data-active:text-emphatic-foreground",
        // icon variant: 32×32 idle well; the green plate is the sliding indicator
        "group-data-[variant=icon]/tabs-list:size-8 group-data-[variant=icon]/tabs-list:flex-none group-data-[variant=icon]/tabs-list:rounded-xl group-data-[variant=icon]/tabs-list:border-0 group-data-[variant=icon]/tabs-list:bg-transparent group-data-[variant=icon]/tabs-list:px-0 group-data-[variant=icon]/tabs-list:justify-center group-data-[variant=icon]/tabs-list:text-foreground/50 group-data-[variant=icon]/tabs-list:transition-[color] group-data-[variant=icon]/tabs-list:data-active:text-emphatic-foreground",
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
