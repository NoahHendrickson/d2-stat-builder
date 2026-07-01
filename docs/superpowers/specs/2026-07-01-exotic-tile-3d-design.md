# Exotic picker tiles: dolores-ds 3D lip treatment

**Date:** 2026-07-01
**Status:** Approved (design agreed in session; this doc records it)

## Goal

Make every exotic thumbnail in `src/components/builder/exotic-picker.tsx` read as a
mini 3D button using the design system's lip treatment (as on Button and Checkbox).
Selection is marked by a **white border line on an exotic-gold lip** instead of the
current blue `ring-2`.

## Non-goals

- No new reusable component. The recipe is applied in place with Tailwind classes
  (same approach as `ui/checkbox.tsx`). Promote to blank-slate-ui only if a second
  consumer appears.
- No change to picker behavior, props, or selection logic.
- No light-mode-specific selected palette (see Risks).

## Design

### Recipe

Use the Checkbox's **tree-order** lip recipe (no negative z-index, so the lip
survives opaque ancestor backgrounds like the Section card's `bg-card`):

- The tile button is `relative`, `rounded-md`, 1px border, no `overflow-hidden`.
- The lip is the button's `::before`: `absolute -inset-x-px -top-px -bottom-[5px]`,
  `rounded-md`, 1px border matching the button's border color, filled with the
  shadow color. It spans the whole tile plus ~4px below (Button-scale lip for a
  44px tile).
- The **image is the face**: as a later sibling in tree order it paints over the
  lip everywhere except the 4px strip poking out below. The image takes the inner
  radius (`rounded-[5px]`) since the button no longer clips.
- The no-icon fallback `<span>` must also act as the face: give it `bg-card` (or
  `bg-background`) + `rounded-[5px]`, otherwise the lip fill shows through the
  whole tile.

### States

| State | Border line (tile + lip) | Lip fill |
|---|---|---|
| Rest | `--neutral-line` | `--neutral-shadow` |
| Hover (unselected) | tile line brightens (e.g. `border-foreground/60`); lip border stays `--neutral-line` | `--neutral-shadow` |
| Selected | `white` | `--exotic` (gold) |
| Active (press, any tile) | unchanged | lip squashes: `active:translate-y-1` + `active:before:-bottom-[2px]` |
| Keyboard focus | standard `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` | unchanged |

`transition-colors` becomes `transition-all` so the press drop animates like Button.

### New token

In `src/app/globals.css`:

- `:root` (and inherited by dark): `--exotic: #ceae33;` — Destiny's exotic gear
  gold. Game-specific, so it lives in the app, not in blank-slate-ui.
- `@theme inline`: `--color-exotic: var(--exotic);` so `bg-exotic` etc. work.

### Layout

- The lip consumes ~4px below each tile: bump the wrap gap from `gap-1.5` to
  `gap-x-1.5 gap-y-2.5`, and the container `space-y-2` to `space-y-3` so the last
  row's lip doesn't crowd the helper text.

## Risks / notes

- **Light mode:** a white selected line is near-invisible on light `bg-card`. The
  app is dark-first (Destiny tool); if light mode ever matters, tokenizing the
  line color is a one-line change. Accepted.
- The blue `ring-primary ring-2` selected state is removed entirely.

## Verification

- `npx tsc --noEmit` and `npm test` stay green (styling-only change).
- Visual check happens in Noah's signed-in tab (picker is auth-gated; a fresh
  preview server can't reach past Bungie OAuth, and Next 16 only allows one dev
  server per project).
