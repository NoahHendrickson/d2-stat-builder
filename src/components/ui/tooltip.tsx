"use client";

import type { ReactElement, ReactNode } from "react";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

function TooltipProvider({
  delay = 150,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} disableHoverablePopup />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} closeDelay={0} />;
}

/**
 * Classic: a rounded popover plate. D2: the item-inspect tooltip, reduced —
 * a near-black square plate with a hairline frame, a brighter top edge, and a
 * deep drop shadow. No radius, no arrow.
 */
function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="pointer-events-none isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 w-fit max-w-xs origin-(--transform-origin) rounded-[10px] corner-smooth border border-border/70 bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg whitespace-pre-line data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:hidden motion-reduce:animate-none d2-glass d2:rounded-none d2:bg-panel-strong d2:shadow-[0_2px_16px_rgb(0_0_0/0.25)] d2:data-open:zoom-in-100",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

/** Shares hover/focus descriptions; disabled controls get a focusable wrapper. */
function TooltipLabel({
  children,
  label,
  delay,
  disabled = false,
}: {
  children: ReactElement;
  label: ReactNode;
  delay?: number;
  disabled?: boolean;
}) {
  if (!label) return children;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          disabled ? (
            <span
              tabIndex={0}
              className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring d2:focus-visible:ring-1 d2:focus-visible:ring-outline-strong [&>*]:pointer-events-none"
            >
              {children}
            </span>
          ) : (
            children
          )
        }
        delay={delay}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { TooltipLabel };
