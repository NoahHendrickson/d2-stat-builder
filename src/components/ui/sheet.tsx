"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { X } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type SheetSide = "bottom" | "top" | "left" | "right";

const SWIPE_DIRECTION = {
  bottom: "down",
  top: "up",
  left: "left",
  right: "right",
} as const satisfies Record<SheetSide, DrawerPrimitive.Root.Props["swipeDirection"]>;

type SheetContextValue = Pick<
  DrawerPrimitive.Root.Props,
  "open" | "onOpenChange" | "defaultOpen"
>;

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheetContext() {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error("Sheet components must be used within a Sheet.");
  }
  return context;
}

function Sheet({
  open,
  onOpenChange,
  defaultOpen,
  children,
}: SheetContextValue & {
  children: React.ReactNode;
}) {
  return (
    <SheetContext.Provider value={{ open, onOpenChange, defaultOpen }}>
      {children}
    </SheetContext.Provider>
  );
}

function SheetTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/20 [--backdrop-opacity:1] opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] duration-200 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*200ms)]",
        className,
      )}
      {...props}
    />
  );
}

const viewportClassNames: Record<SheetSide, string> = {
  bottom: "fixed inset-0 z-50 flex items-end justify-center",
  top: "fixed inset-0 z-50 flex items-start justify-center",
  left: "fixed inset-0 z-50 flex items-stretch justify-start",
  right: "fixed inset-0 z-50 flex items-stretch justify-end",
};

const popupClassNames: Record<SheetSide, string> = {
  bottom:
    "w-full max-h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)] [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-200 ease-out data-swiping:select-none data-ending-style:translate-y-full data-starting-style:translate-y-full data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*200ms)]",
  top: "w-full max-h-[85dvh] rounded-b-xl pt-[env(safe-area-inset-top)] [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-200 ease-out data-swiping:select-none data-ending-style:-translate-y-full data-starting-style:-translate-y-full data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*200ms)]",
  left: "h-full w-[min(100%,20rem)] [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-200 ease-out data-swiping:select-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*200ms)]",
  right:
    "h-full w-[min(100%,20rem)] [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-200 ease-out data-swiping:select-none data-ending-style:translate-x-full data-starting-style:translate-x-full data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*200ms)]",
};

function SheetContent({
  className,
  children,
  side = "bottom",
  showCloseButton = true,
  ...props
}: DrawerPrimitive.Popup.Props & {
  side?: SheetSide;
  showCloseButton?: boolean;
}) {
  const { open, onOpenChange, defaultOpen } = useSheetContext();

  return (
    <DrawerPrimitive.Root
      data-slot="sheet"
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={defaultOpen}
      swipeDirection={SWIPE_DIRECTION[side]}
    >
      <SheetPortal>
        <SheetOverlay />
        <DrawerPrimitive.Viewport className={viewportClassNames[side]}>
          <DrawerPrimitive.Popup
            data-slot="sheet-content"
            className={cn(
              "relative z-50 flex flex-col bg-popover text-popover-foreground ring-1 ring-foreground/10 outline-none data-open:animate-in data-closed:animate-out",
              popupClassNames[side],
              className,
            )}
            {...props}
          >
            {side === "bottom" && (
              <div
                className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30"
                aria-hidden
              />
            )}
            <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col">
              {children}
            </DrawerPrimitive.Content>
            {showCloseButton && (
              <DrawerPrimitive.Close
                data-slot="sheet-close"
                render={
                  <Button
                    variant="ghost"
                    className="absolute top-3 right-3"
                    size="icon-sm"
                  />
                }
              >
                <X weight="bold" className="size-4" />
                <span className="sr-only">Close</span>
              </DrawerPrimitive.Close>
            )}
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </SheetPortal>
    </DrawerPrimitive.Root>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 px-4 pt-2 pb-3", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
