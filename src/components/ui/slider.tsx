"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

// App-specific fork of @noey-ui/slider: keeps the achievable-ceiling overlay,
// hover/drag value tooltip and `sliderValueLeft` (used by builder-panel ticks),
// styled to Figma 73:1613: a 10px well inside a frame that sits 2px out
// (a pseudo-element carrying the app's centre-bright line, so it costs no
// layout), a bright-to-deep green gradient fill (#54c55f to #378b3f) wearing the same line in white, a
// white/12 "achievable" fill behind it, and a 2px white thumb, 16px tall so it spans
// the frame, on the fill's edge.
// Re-adding from the registry with --overwrite will drop those features.

function clampNumber(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Thumb width in px — keep in sync with the Thumb's `w-*` class. */
const THUMB_PX = 2

function sliderFraction(value: number, min: number, max: number) {
  return max <= min ? 0 : (value - min) / (max - min)
}

/**
 * CSS `left` for the thumb's center at `value`. The thumb is edge-aligned
 * (inset so it never overhangs the track), so its center runs from
 * THUMB_PX/2 to width - THUMB_PX/2 rather than 0% to 100%.
 */
function sliderValueLeft(value: number, min: number, max: number): string {
  const fraction = sliderFraction(value, min, max)
  return `calc(${fraction * 100}% + ${THUMB_PX / 2 - THUMB_PX * fraction}px)`
}

/** Track fill width at `value`: 0% at min, 100% at max. */
function sliderFillWidth(value: number, min: number, max: number): string {
  return `${sliderFraction(value, min, max) * 100}%`
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  ceiling,
  ...props
}: SliderPrimitive.Root.Props & {
  /** Optional achievable-maximum overlay: a lighter fill from `min` up to this value. */
  ceiling?: number
}) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  const horizontal = props.orientation !== "vertical"

  // Hover/drag tooltip: `x` is the badge anchor relative to the control; `value`
  // is what a click at the cursor would set, mirroring Base UI's edge-aligned
  // pointer mapping: the usable range is the control width minus the thumb,
  // offset by half a thumb (control has no horizontal padding/border).
  const [hover, setHover] = React.useState<{ x: number; value: number } | null>(
    null
  )
  const [dragging, setDragging] = React.useState(false)
  // The control's box, measured once per hover/drag (pointerenter / pointerdown)
  // rather than on every pointermove — a layout read per tick forces synchronous
  // layout while the thumb is animating.
  const rectRef = React.useRef<DOMRect | null>(null)
  const measure = (e: React.PointerEvent<HTMLDivElement>) => {
    rectRef.current = e.currentTarget.getBoundingClientRect()
  }

  function updateHover(e: React.PointerEvent<HTMLDivElement>) {
    if (!horizontal || max <= min) return
    const rect = rectRef.current ?? (rectRef.current = e.currentTarget.getBoundingClientRect())
    const range = rect.width - THUMB_PX
    if (range <= 0) return
    const fraction = clampNumber(
      (e.clientX - rect.left - THUMB_PX / 2) / range,
      0,
      1
    )
    const raw = min + fraction * (max - min)
    const snapped = clampNumber(
      Math.round((raw - min) / step) * step + min,
      min,
      max
    )
    setHover({
      x: THUMB_PX / 2 + fraction * range,
      value: snapped,
    })
  }

  // While dragging a controlled single-value slider, show the actual value —
  // exact even when the thumb was grabbed off-center. Ranges and uncontrolled
  // sliders fall back to the cursor-derived value.
  const liveValue =
    dragging && value != null && (!Array.isArray(value) || value.length === 1)
      ? Array.isArray(value)
        ? value[0]
        : value
      : null

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      step={step}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control
        className="group/slider relative flex w-full touch-none items-center select-none data-disabled:opacity-40 data-horizontal:py-1.5 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col"
        onPointerEnter={measure}
        onPointerMove={updateHover}
        onPointerDown={(e) => {
          measure(e)
          setDragging(true)
          updateHover(e)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => {
          rectRef.current = null
          setDragging(false)
          setHover(null)
        }}
        onPointerCancel={() => {
          setDragging(false)
          setHover(null)
        }}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          // box-content: Base UI sets `height: inherit` (horizontal) / `width: inherit`
          // (vertical) on the Indicator, so the track's declared size must be its
          // inner size. The 10px well; the frame is a ::before 3px outside it
          // (2px gap + the 1px line).
          className="relative box-content grow rounded-none select-none before:pointer-events-none before:absolute before:-inset-[3px] before:d2-line before:content-[''] data-horizontal:h-2.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-2.5"
        >
          {ceiling != null && (
            <div
              data-slot="slider-ceiling"
              aria-hidden
              className="absolute top-0 left-0 h-full bg-foreground/12 transition-[width] duration-300 ease-out"
              style={{
                width: sliderFillWidth(ceiling, min, max),
              }}
            />
          )}
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="d2-line-white bg-[linear-gradient(to_right,#54c55f,#378b3f)] select-none data-horizontal:h-full data-vertical:w-full data-vertical:bg-[linear-gradient(to_top,#54c55f,#378b3f)]"
          />
        </SliderPrimitive.Track>
        {hover != null && (
          <div
            data-slot="slider-tooltip"
            aria-hidden
            className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-[4px] border border-foreground/15 bg-popover px-1.5 py-0.5 text-[11px] font-medium text-popover-foreground tabular-nums shadow-[0_6px_16px_rgb(0_0_0/0.5)]"
            style={{ left: hover.x }}
          >
            {liveValue ?? hover.value}
          </div>
        )}
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block h-4 w-0.5 shrink-0 rounded-none bg-foreground transition-[box-shadow] select-none after:absolute after:-inset-x-3 after:-inset-y-2 hover:shadow-[0_0_6px_color-mix(in_srgb,var(--foreground)_60%,transparent)] focus-visible:shadow-[0_0_0_1px_var(--foreground),0_0_8px_color-mix(in_srgb,var(--foreground)_60%,transparent)] focus-visible:outline-hidden active:shadow-[0_0_8px_color-mix(in_srgb,var(--foreground)_80%,transparent)] disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider, sliderValueLeft }
