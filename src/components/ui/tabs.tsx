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

/** D2 (Figma 77:1640) well: square frame, faint fill, EQUIP plate under the active cell. Classic keeps its rounded track and pill. */
const wellTrack =
  "d2:rounded-none d2:border d2:border-foreground/16 d2:bg-primary/6 d2:dark:bg-primary/6 d2:p-0.5"
const wellPlate =
  "d2:rounded-none d2:border-transparent d2:bg-transparent d2-equip group-has-[[data-active]:hover]/tabs-list:[--equip-fill:var(--emphatic-light)] group-has-[[data-active]:hover]/tabs-list:d2-line-drift"

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
        // Classic (Figma "Tabs List" 54:386 light / 54:393 dark): flush track,
        // #E8E4E1 on light, white 8% over the stage on dark, radius matches Button (10px).
        default: cn(
          "group-data-horizontal/tabs:h-8 overflow-clip rounded-[10px] corner-smooth bg-[#E8E4E1] dark:bg-foreground/8",
          wellTrack,
        ),
        // Classic: same 36px row as the loadouts search / icon buttons so the header strip lines up.
        // D2: 2px pad + 1px line around two 32px cells (70×38).
        icon: cn(
          "h-9 overflow-clip rounded-[10px] corner-smooth bg-foreground/6 d2:h-auto",
          wellTrack,
        ),
        line: "group-data-horizontal/tabs:h-8 gap-1 rounded-none bg-transparent p-[3px] d2:gap-4 d2:border-b d2:border-foreground/12 d2:p-0",
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
        // Classic (54:393 dark): the active pill is the stage surface recessed
        // into the track, bordered with the track colour — not a lighter raise.
        default: cn(
          "rounded-[10px] corner-smooth border border-foreground/12 bg-card dark:border-foreground/8",
          wellPlate,
        ),
        // Classic: recessed into the track with the header surface (sidebar when
        // open, page background when collapsed) so the pill doesn't flash a second
        // color. D2: the EQUIP plate slides under the icons; hover lightens like the CTA.
        icon: cn(
          "rounded-[10px] corner-smooth border border-foreground/6 bg-[var(--icon-tab-surface,var(--sidebar))]",
          wellPlate,
        ),
        line: "bg-primary group-data-horizontal/tabs:top-[calc(var(--active-tab-top)+var(--active-tab-height)+3px)] group-data-horizontal/tabs:h-0.5 group-data-horizontal/tabs:translate-y-0 group-data-vertical/tabs:left-[calc(var(--active-tab-left)+var(--active-tab-width)+2px)] group-data-vertical/tabs:w-0.5 group-data-vertical/tabs:translate-x-0 d2:bg-foreground d2:group-data-horizontal/tabs:top-[calc(var(--active-tab-top)+var(--active-tab-height)-2px)] d2:group-data-vertical/tabs:left-[calc(var(--active-tab-left)+var(--active-tab-width)-2px)]",
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
        "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 d2:rounded-none d2:focus-visible:border-transparent d2:focus-visible:ring-0 d2:focus-visible:outline-offset-2 d2:focus-visible:outline-outline-strong d2:disabled:opacity-40 d2:aria-disabled:opacity-40",
        // default variant. Classic: full-height pill (h-8, px-3, radius matches Button)
        // inside the track. D2: labelled cell in the well; the green plate is the sliding indicator.
        "group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:rounded-[10px] group-data-[variant=default]/tabs-list:corner-smooth group-data-[variant=default]/tabs-list:px-3 d2:group-data-[variant=default]/tabs-list:h-8 d2:group-data-[variant=default]/tabs-list:min-w-8 d2:group-data-[variant=default]/tabs-list:flex-none d2:group-data-[variant=default]/tabs-list:rounded-none d2:group-data-[variant=default]/tabs-list:border-0 d2:group-data-[variant=default]/tabs-list:bg-transparent d2:group-data-[variant=default]/tabs-list:px-2.5 d2:group-data-[variant=default]/tabs-list:text-foreground/50 d2:group-data-[variant=default]/tabs-list:transition-[color] d2:group-data-[variant=default]/tabs-list:data-active:text-emphatic-foreground",
        // icon variant. Classic: 36×36 square, no label padding. D2: 32×32 idle
        // well; the green plate is the sliding indicator.
        "group-data-[variant=icon]/tabs-list:size-9 group-data-[variant=icon]/tabs-list:flex-none group-data-[variant=icon]/tabs-list:rounded-[10px] group-data-[variant=icon]/tabs-list:corner-smooth group-data-[variant=icon]/tabs-list:px-0 group-data-[variant=icon]/tabs-list:justify-center d2:group-data-[variant=icon]/tabs-list:size-8 d2:group-data-[variant=icon]/tabs-list:rounded-xl d2:group-data-[variant=icon]/tabs-list:border-0 d2:group-data-[variant=icon]/tabs-list:bg-transparent d2:group-data-[variant=icon]/tabs-list:text-foreground/50 d2:group-data-[variant=icon]/tabs-list:transition-[color] d2:group-data-[variant=icon]/tabs-list:data-active:text-emphatic-foreground",
        // line variant: compact trigger; the underline lives on the sliding indicator
        "group-data-[variant=line]/tabs-list:h-[calc(100%-1px)] group-data-[variant=line]/tabs-list:px-1.5 group-data-[variant=line]/tabs-list:py-0.5 group-data-[variant=line]/tabs-list:bg-transparent d2:group-data-[variant=line]/tabs-list:h-full d2:group-data-[variant=line]/tabs-list:rounded-none d2:group-data-[variant=line]/tabs-list:px-0.5 d2:group-data-[variant=line]/tabs-list:py-0 d2:group-data-[variant=line]/tabs-list:pb-0.5 d2:group-data-[variant=line]/tabs-list:text-sm",
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
