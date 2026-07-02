"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function clampNumber(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
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
  // pointer mapping (control has no horizontal padding/border, so none is
  // subtracted here — keep the two in sync).
  const [hover, setHover] = React.useState<{ x: number; value: number } | null>(
    null
  )
  const [dragging, setDragging] = React.useState(false)

  function updateHover(e: React.PointerEvent<HTMLDivElement>) {
    if (!horizontal || max <= min) return
    const control = e.currentTarget
    const rect = control.getBoundingClientRect()
    const thumbWidth =
      control
        .querySelector<HTMLElement>('[data-slot="slider-thumb"]')
        ?.getBoundingClientRect().width ?? 0
    const trackSize = rect.width - thumbWidth
    if (trackSize <= 0) return
    const fraction = clampNumber(
      (e.clientX - rect.left - thumbWidth / 2) / trackSize,
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
      x: clampNumber(e.clientX - rect.left, 0, rect.width),
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
        className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-horizontal:py-1.5 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col"
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
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          {ceiling != null && (
            <div
              data-slot="slider-ceiling"
              aria-hidden
              className="absolute left-0 h-full bg-foreground/25 transition-[width] duration-300 ease-out"
              style={{ width: `${((ceiling - min) / (max - min)) * 100}%` }}
            />
          )}
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {hover != null && (
          <div
            data-slot="slider-tooltip"
            aria-hidden
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-xs font-medium text-background tabular-nums"
            style={{ left: hover.x }}
          >
            {liveValue ?? hover.value}
          </div>
        )}
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative isolate block size-3.5 shrink-0 rounded-full border-0 bg-transparent transition-transform duration-150 ease-out select-none before:absolute before:-inset-x-px before:-top-px before:-bottom-[3px] before:rounded-full before:border before:border-brand before:bg-[var(--brand-shadow)] before:transition-[bottom] before:duration-150 before:ease-out before:content-[''] after:absolute after:-inset-px after:rounded-full after:border after:border-brand after:bg-white after:content-[''] active:translate-y-0.5 active:before:-bottom-px focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden focus-visible:after:border-ring motion-reduce:transition-none motion-reduce:active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
