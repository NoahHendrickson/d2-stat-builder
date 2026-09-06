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
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

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
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 w-fit max-w-xs origin-(--transform-origin) rounded-[10px] corner-smooth border border-border/70 bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg whitespace-pre-line data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
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
              className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&>*]:pointer-events-none"
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
