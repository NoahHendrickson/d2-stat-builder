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

const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center justify-center text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        // Figma "Tabs List" (54:386 light / 54:393 dark): flush track,
        // #E8E4E1 on light, #313131 on dark, radius matches Button (10px).
        default:
          "overflow-clip rounded-[10px] corner-smooth bg-[#E8E4E1] dark:bg-[#313131]",
        // Figma "IconTabList" (1:229): 32px icon track filled with foreground at 6%
        // (the file's --primary), radius matches Button.
        icon: "overflow-clip rounded-[10px] corner-smooth bg-foreground/6",
        line: "gap-1 rounded-none bg-transparent p-[3px]",
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
        // Figma (54:393 dark): the active pill is the page background recessed
        // into the track, bordered with the track colour — not a lighter raise.
        default:
          "rounded-[10px] corner-smooth border border-foreground/12 bg-background dark:border-[#313131]",
        // Recessed into the track with the header surface (sidebar when open,
        // page background when collapsed) so the pill doesn't flash a second color.
        icon: "rounded-[10px] corner-smooth border border-foreground/6 bg-[var(--icon-tab-surface,var(--sidebar))]",
        line: "bg-primary group-data-horizontal/tabs:top-[calc(var(--active-tab-top)+var(--active-tab-height)+3px)] group-data-horizontal/tabs:h-0.5 group-data-horizontal/tabs:translate-y-0 group-data-vertical/tabs:left-[calc(var(--active-tab-left)+var(--active-tab-width)+2px)] group-data-vertical/tabs:w-0.5 group-data-vertical/tabs:translate-x-0",
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
        "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // default variant: full-height pill (h-8, px-3, radius matches Button) inside the track
        "group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:rounded-[10px] group-data-[variant=default]/tabs-list:corner-smooth group-data-[variant=default]/tabs-list:px-3",
        // icon variant: 32×32 square, no label padding
        "group-data-[variant=icon]/tabs-list:size-8 group-data-[variant=icon]/tabs-list:flex-none group-data-[variant=icon]/tabs-list:rounded-[10px] group-data-[variant=icon]/tabs-list:corner-smooth group-data-[variant=icon]/tabs-list:px-0 group-data-[variant=icon]/tabs-list:justify-center",
        // line variant: compact trigger; underline lives on the sliding indicator
        "group-data-[variant=line]/tabs-list:h-[calc(100%-1px)] group-data-[variant=line]/tabs-list:px-1.5 group-data-[variant=line]/tabs-list:py-0.5 group-data-[variant=line]/tabs-list:bg-transparent",
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
