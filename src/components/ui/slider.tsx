"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"
import { useSkin } from "@/lib/use-skin"

// App-specific fork of @noey-ui/slider: keeps the achievable-ceiling overlay,
// hover/drag value tooltip and `sliderValueLeft` (used by builder-panel ticks).
// Classic (Figma "Progress" 14:5187): an 8px bordered track with the emphatic
// raised indicator and an always-visible, edge-aligned 16px round thumb.
// D2 (Figma 73:1613): a 10px well inside a frame that sits 2px out (a
// pseudo-element carrying the centre-bright line, so it costs no layout), a
// bright-to-deep green gradient fill (#54c55f to #378b3f) wearing the same
// line in white, a white/12 "achievable" fill behind it, and a 2px white thumb,
// 16px tall so it spans the frame, on the fill's edge.
// Re-adding from the registry with --overwrite will drop those features.

function clampNumber(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Thumb width in px per skin — keep in sync with the Thumb's `size-*` / `d2:w-*` classes. */
const THUMB_PX = { classic: 16, d2: 2 } as const

/** The active skin's thumb width, for callers laying out against `sliderValueLeft`. */
function useSliderThumbPx(): number {
  const { skin } = useSkin()
  return THUMB_PX[skin]
}

function sliderFraction(value: number, min: number, max: number) {
  return max <= min ? 0 : (value - min) / (max - min)
}

/**
 * CSS `left` for the thumb's center at `value`. The thumb is edge-aligned
 * (inset so it never overhangs the track), so its center runs from
 * thumbPx/2 to width - thumbPx/2 rather than 0% to 100%.
 */
function sliderValueLeft(
  value: number,
  min: number,
  max: number,
  thumbPx: number
): string {
  const fraction = sliderFraction(value, min, max)
  return `calc(${fraction * 100}% + ${thumbPx / 2 - thumbPx * fraction}px)`
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
  const thumbPx = useSliderThumbPx()

  // Hover/drag tooltip: `x` is the badge anchor relative to the control; `value`
  // is what a click at the cursor would set, mirroring Base UI's edge-aligned
  // pointer mapping: the usable range is the control width minus the thumb,
  // offset by half a thumb (control has no horizontal padding/border).
  const [hover, setHover] = React.useState<{ x: number; value: number } | null>(
    null
  )
  const [dragging, setDragging] = React.useState(false)

  function updateHover(e: React.PointerEvent<HTMLDivElement>) {
    if (!horizontal || max <= min) return
    const rect = e.currentTarget.getBoundingClientRect()
    const range = rect.width - thumbPx
    if (range <= 0) return
    const fraction = clampNumber(
      (e.clientX - rect.left - thumbPx / 2) / range,
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
      x: thumbPx / 2 + fraction * range,
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
        className="group/slider relative flex w-full touch-none items-center select-none data-disabled:opacity-50 d2:data-disabled:opacity-40 data-horizontal:py-1.5 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col"
        onPointerMove={updateHover}
        onPointerDown={(e) => {
          setDragging(true)
          updateHover(e)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => {
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
          // inner size. Classic: a border-box 8px track would leave the 8px
          // indicator clipped on one side by overflow-hidden, so 6px + 1px border.
          // D2: the 10px well; the frame is a ::before 3px outside it
          // (2px gap + the 1px line, via d2-slider-frame).
          className="relative box-content grow overflow-hidden rounded-[4px] border border-border bg-muted select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5 dark:bg-foreground/12 d2-slider-frame d2:overflow-visible d2:rounded-none d2:border-0 d2:bg-transparent d2:dark:bg-transparent d2:data-horizontal:h-2.5 d2:data-vertical:w-2.5"
        >
          {ceiling != null && (
            <div
              data-slot="slider-ceiling"
              aria-hidden
              className="absolute top-0 left-0 h-full rounded-[3px] bg-foreground/40 shadow-raised transition-[width] duration-300 ease-out d2:rounded-none d2:bg-foreground/12 d2:shadow-none"
              style={{
                width: sliderFillWidth(ceiling, min, max),
              }}
            />
          )}
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="rounded-[3px] border border-input bg-emphatic shadow-raised select-none data-horizontal:h-full data-vertical:w-full dark:border-white/24 d2-line-white d2:rounded-none d2:bg-[linear-gradient(to_right,#54c55f,#378b3f)] d2:shadow-none d2:data-vertical:bg-[linear-gradient(to_top,#54c55f,#378b3f)]"
          />
        </SliderPrimitive.Track>
        {hover != null && (
          <div
            data-slot="slider-tooltip"
            aria-hidden
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-xs font-medium text-background tabular-nums d2:mb-1.5 d2:rounded-[4px] d2:border d2:border-foreground/15 d2:bg-popover d2:text-[11px] d2:text-popover-foreground d2:shadow-[0_6px_16px_rgb(0_0_0/0.5)]"
            style={{ left: hover.x }}
          >
            {liveValue ?? hover.value}
          </div>
        )}
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-4 shrink-0 rounded-full border border-emphatic-dark bg-emphatic-foreground shadow-raised ring-ring/50 transition-[box-shadow] select-none after:absolute after:-inset-2 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50 d2:w-0.5 d2:rounded-none d2:border-0 d2:bg-white d2:shadow-none d2:after:-inset-x-3 d2:after:-inset-y-2 d2:hover:shadow-[0_0_6px_rgb(255_255_255/0.6)] d2:focus-visible:ring-0 d2:focus-visible:shadow-[0_0_0_1px_#fff,0_0_8px_rgb(255_255_255/0.6)] d2:active:ring-0 d2:active:shadow-[0_0_8px_rgb(255_255_255/0.8)]"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider, sliderValueLeft, useSliderThumbPx }
