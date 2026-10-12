"use client";

import {
  createContext,
  use,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

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

type Handle = TooltipPrimitive.Handle<unknown>;

/** The handle of the enclosing `Tooltip`, so a press-and-hold on its trigger can open it. */
const TooltipHandleContext = createContext<Handle | null>(null);

/**
 * Base UI's own Root, left uncontrolled. It gets a handle so a touch hold (touch never
 * hovers) can open it through Base UI rather than a second open state.
 */
function Tooltip({ handle, ...props }: TooltipPrimitive.Root.Props) {
  const [ownHandle] = useState(() => handle ?? TooltipPrimitive.createHandle());
  const bound = handle ?? ownHandle;
  return (
    <TooltipHandleContext value={bound}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} handle={bound} disableHoverablePopup />
    </TooltipHandleContext>
  );
}

/** How long a finger rests on a trigger before its tooltip opens. */
const TOUCH_HOLD_MS = 450;
/** Drift past this and the press is a scroll, not a hold. */
const TOUCH_HOLD_SLOP_PX = 10;
/** The click that ends a hold follows the pointerup; anything later is a new press. */
const HOLD_CLICK_MS = 400;

/**
 * Press-and-hold for touch, shared by every trigger through one set of document
 * listeners: a still finger opens the tooltip, the tap that ends the hold is swallowed
 * (so holding a perk shows it without also picking it), and the next touch or scroll
 * closes it.
 */
const touchHold = {
  press: null as { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null,
  /** The tooltip a hold opened. */
  open: null as Handle | null,
  swallowClick: false,
  listening: false,

  start(handle: Handle, trigger: HTMLElement, e: PointerEvent) {
    this.listen();
    this.cancel();
    const { id } = trigger;
    this.press = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        this.press = null;
        if (!trigger.isConnected) return;
        handle.open(id);
        this.open = handle;
        this.swallowClick = true;
      }, TOUCH_HOLD_MS),
    };
  },
  cancel() {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  },
  close() {
    this.open?.close();
    this.open = null;
  },
  listen() {
    if (this.listening) return;
    this.listening = true;
    const capture = { capture: true };
    document.addEventListener("pointerdown", () => this.close(), capture);
    document.addEventListener("scroll", () => this.close(), capture);
    document.addEventListener("pointermove", (e) => {
      const p = this.press;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TOUCH_HOLD_SLOP_PX) this.cancel();
    });
    const release = () => {
      this.cancel();
      if (this.swallowClick) setTimeout(() => (this.swallowClick = false), HOLD_CLICK_MS);
    };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    document.addEventListener(
      "click",
      (e) => {
        if (!this.swallowClick) return;
        this.swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      },
      capture,
    );
    document.addEventListener(
      "contextmenu",
      (e) => {
        // Android's long-press menu would land on top of the tooltip.
        if (this.press || this.swallowClick) e.preventDefault();
      },
      capture,
    );
  },
};

function TooltipTrigger({ onPointerDown, ...props }: TooltipPrimitive.Trigger.Props) {
  const handle = props.handle ?? use(TooltipHandleContext);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(e) => {
        onPointerDown?.(e);
        const trigger = e.currentTarget as HTMLElement;
        // `data-trigger-disabled` covers a disabled trigger and a disabled Root alike.
        if (e.pointerType === "touch" && handle && !trigger.hasAttribute("data-trigger-disabled")) {
          touchHold.start(handle, trigger, e);
        }
      }}
      {...props}
      closeDelay={0}
    />
  );
}

/**
 * The item-inspect tooltip, reduced: a near-black square plate with a hairline
 * frame, a brighter top edge, and a deep drop shadow. No radius, no arrow.
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
            "z-50 w-fit max-w-xs max-md:max-w-[calc(100vw-1rem)] origin-(--transform-origin) d2-glass rounded-none bg-panel-strong px-3 py-2 text-xs leading-relaxed text-popover-foreground whitespace-pre-line data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-instant:animate-none data-closed:hidden motion-reduce:animate-none",
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
              className="inline-flex rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-outline-strong [&>*]:pointer-events-none"
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
