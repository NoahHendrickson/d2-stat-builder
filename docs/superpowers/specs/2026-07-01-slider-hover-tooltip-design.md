# Slider hover value tooltip — design

**Date:** 2026-07-01
**Status:** Approved (design discussed and accepted in session)

## Problem

The stat target sliders in the builder panel (0–200) support click-to-set: clicking a
spot on the track jumps the target to that value. But while hovering, the user has no
feedback about *which* value a click will set — they have to click and check the number
input afterward.

## Goal

While the pointer is over a slider, show a small tooltip above the cursor with the
snapped value at that x position — exactly the value a click there would set. The same
tooltip stays visible and live during drags.

## Non-goals

- No changes to slider behavior (click-to-set, drag, keyboard all unchanged).
- No new dependencies or tooltip primitives.
- No API changes required in `builder-panel.tsx` (always-on for the shared slider;
  the builder panel is currently its only consumer).

## Behavior

- **Hover:** pointer over the slider control → badge above the cursor showing the value
  at that x, snapped to `step` and clamped to `[min, max]`.
- **Drag:** badge keeps following the pointer and shows the live value. Since the thumb
  tracks the cursor, this equals the current slider value (clamped at the ends).
- **Touch:** shown during touch drags too — extra useful since the finger obscures the
  thumb.
- **Hide:** on pointer leave and pointer cancel.
- The badge anchor x is clamped to the control bounds; the badge is centered on the
  anchor, so at the extreme ends up to half the badge may overhang — it stays
  cursor-anchored rather than snapping inward.

## Implementation

All in `src/components/ui/slider.tsx`:

- Add `onPointerMove` / `onPointerLeave` / `onPointerCancel` handlers on
  `SliderPrimitive.Control`, holding `{x, value} | null` in local state.
- Value mapping: pointer x → fraction along the track → `min + fraction * (max - min)`,
  snapped to `step`, clamped. Must match Base UI's own pointer→value mapping
  (`thumbAlignment="edge"` accounted for) so the tooltip number agrees with what a
  click actually sets.
- During drags, Base UI pointer-captures the control, so the same `onPointerMove`
  handler covers both hover and drag.
- The badge: absolutely positioned above the track at the cursor x,
  `pointer-events-none`, `aria-hidden`, small rounded chip with `tabular-nums`,
  styled consistently with the app's existing tooltip look.
- Horizontal orientation only (the app only uses horizontal sliders); vertical sliders
  simply don't render the badge.

## Error handling

Degenerate ranges (`max <= min`) render no badge rather than dividing by zero.
Non-mouse pointers behave the same as mouse; there is no hover state on touch, so the
badge only appears during an active touch drag.

## Testing

Browser-preview verification:

1. Hover at several positions; confirm the tooltip number equals the value a click at
   that spot sets (check against the number input).
2. Drag the thumb; confirm the badge follows with the live value, including past the
   ends (clamped).
3. Pointer leave hides the badge.

No unit tests: the logic is geometry + DOM measurement, best verified in the browser.
