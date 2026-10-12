"use client";

import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/** How long a finger rests on a trigger before its tooltip opens. */
const TOUCH_HOLD_MS = 450;
/** Drift past this and the press is a scroll, not a hold. */
const TOUCH_HOLD_SLOP_PX = 10;
/** Phones only (Tailwind `max-md`); tablets and up keep hover and focus alone. */
const TOUCH_HOLD_QUERY = "(width < 48rem)";

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

/** Lets a trigger open its own tooltip from a touch hold. Null when the caller controls `open`. */
const TooltipHoldContext = createContext<((open: boolean) => void) | null>(null);

/**
 * Controlled internally (mirroring Base UI's own open/close) so a press-and-hold on a
 * phone can open it too: touch never hovers, so without this a description that only
 * lives in a tooltip is out of reach there.
 */
function Tooltip({ open, onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = open !== undefined;
  return (
    <TooltipHoldContext value={controlled ? null : setOwnOpen}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...props}
        open={controlled ? open : ownOpen}
        onOpenChange={(next, details) => {
          if (!controlled) setOwnOpen(next);
          onOpenChange?.(next, details);
        }}
        disableHoverablePopup
      />
    </TooltipHoldContext>
  );
}

/**
 * Press-and-hold for phones: a still finger opens the tooltip, the tap that ends the
 * hold is swallowed (so holding a perk shows it without also picking it), and the next
 * touch anywhere closes it.
 */
function useTouchHold(setOpen: ((open: boolean) => void) | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const [open, setHeldOpen] = useState(false);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open || !setOpen) return;
    const close = () => {
      setHeldOpen(false);
      setOpen(false);
    };
    // Deferred past the touch that opened it, which is still in flight.
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", close, { capture: true, once: true });
      document.addEventListener("scroll", close, { capture: true, once: true });
    });
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", close, { capture: true });
      document.removeEventListener("scroll", close, { capture: true });
    };
  }, [open, setOpen]);

  if (!setOpen) return undefined;
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown(e: PointerEvent) {
      held.current = false;
      if (e.pointerType !== "touch" || !window.matchMedia(TOUCH_HOLD_QUERY).matches) return;
      start.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        held.current = true;
        setHeldOpen(true);
        setOpen(true);
      }, TOUCH_HOLD_MS);
    },
    onPointerMove(e: PointerEvent) {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > TOUCH_HOLD_SLOP_PX) cancel();
    },
    onPointerUp() {
      cancel();
      // The click that ends a hold follows the pointerup; anything later is a new press.
      if (held.current) setTimeout(() => (held.current = false), 400);
    },
    onPointerCancel: cancel,
    onClickCapture(e: { preventDefault(): void; stopPropagation(): void }) {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu(e: { preventDefault(): void }) {
      // Android's long-press menu would land on top of the tooltip.
      if (start.current || held.current) e.preventDefault();
    },
  };
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  const hold = useTouchHold(use(TooltipHoldContext));
  return (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...hold} {...props} closeDelay={0} />
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
