# Slider Hover Value Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While hovering or dragging a stat slider, show a small badge above the cursor with the snapped value at that position — exactly the value a click there would set.

**Architecture:** All changes live in the shared `Slider` wrapper (`src/components/ui/slider.tsx`). Pointer handlers on Base UI's `Slider.Control` compute the value under the cursor using the same geometry Base UI uses internally for `thumbAlignment="edge"`, and render an absolutely-positioned badge. Base UI pointer-captures the control during drags, so the same `onPointerMove` handler covers hover and drag; during a drag the badge shows the controlled value (exact, immune to off-center thumb grabs).

**Tech Stack:** React 19 client component, Base UI `@base-ui/react/slider`, Tailwind classes. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-01-slider-hover-tooltip-design.md`

## Global Constraints

- No API changes for consumers (`builder-panel.tsx` keeps using `<Slider min max step value onValueChange ceiling />` unchanged).
- Tooltip value must match what a click actually sets. Base UI's mapping for horizontal LTR `thumbAlignment="edge"` sliders is: `fraction = clamp((clientX - rect.left - thumbWidth/2) / (rect.width - thumbWidth), 0, 1)`, then `value = clamp(round((min + fraction*(max-min) - min) / step) * step + min, min, max)`. (Control border/horizontal padding also subtract from this, but our Control has none — `py-1.5` only. Do not add horizontal padding/border to the Control without updating the formula.)
- Badge is presentation-only: `pointer-events-none`, `aria-hidden`.
- Horizontal orientation only; vertical sliders render no badge. LTR only (app is LTR).
- Degenerate ranges (`max <= min`, zero-width track) render no badge.
- No unit tests (per spec — geometry + DOM measurement; verified in the browser). Existing suite must still pass.

---

### Task 1: Hover/drag value tooltip in the Slider component

**Files:**
- Modify: `src/components/ui/slider.tsx` (whole file replacement below)
- Verify in: browser preview at the builder panel (`npm run dev` → https://localhost:4321)

**Interfaces:**
- Consumes: `SliderPrimitive.Root.Props` from `@base-ui/react/slider` (already in use).
- Produces: same `Slider` export, no signature change. New internal-only behavior.

- [ ] **Step 1: Replace `src/components/ui/slider.tsx` with the implementation**

```tsx
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
```

Notes for the implementer:
- `step` was previously passed through `...props`; it is now destructured (default `1`, matching Base UI) and passed explicitly because the hover math needs it. Behavior for consumers is unchanged.
- Drag persistence works because Base UI calls `control.setPointerCapture()` on drag start (see `node_modules/@base-ui/react/slider/control/SliderControl.mjs`, `setPointerCapture` call in the pointerdown handler) — while captured, `pointermove` keeps retargeting to the Control and `pointerleave` is deferred until release, so the badge follows past the track ends and hides correctly on release-outside.
- The badge anchor x is the raw cursor position clamped to the control box; at the extreme ends up to half the badge overhangs, which is intentional (cursor-anchored, not thumb-anchored).

- [ ] **Step 2: Lint and run the existing test suite**

Run: `npm run lint && npm test`
Expected: eslint clean; all existing vitest suites pass (no tests touch the slider).

- [ ] **Step 3: Verify in the browser preview**

Start the dev server (preview tools; `npm run dev`, port 4321, https). On the builder page:

1. Hover a stat slider at ~25%, ~50%, ~90% of the track: a badge appears above the cursor showing an integer 0–200 that increases left→right, 0 at the far left edge, 200 at the far right edge.
2. Click one hovered spot: the number input on the right updates to exactly the value the badge showed at that spot.
3. Press and drag the thumb: the badge follows the cursor and its number matches the number input live; drag past the right end — badge clamps at the end showing 200 (or the max) and hides only after release outside the control.
4. Move the pointer off the slider: badge disappears.
5. Confirm nothing clips the badge (it renders above the track, over neighboring rows).

Expected: all five checks pass. If the badge value disagrees with the click-set value by ±1 anywhere, the geometry formula is out of sync with Base UI — re-check the thumb-width subtraction before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/slider.tsx
git commit -m "feat: hover/drag value tooltip on stat sliders"
```
