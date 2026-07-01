# Stat Builder — adopt Base UI via the blank-slate-ui registry

Date: 2026-07-01
Status: Approved (design)

## Goal

Bring the visual style of the `blank-slate-ui` component library into stat-builder —
both the theme tokens (blue brand palette, custom shadow/line tokens, tighter radius)
and the component look (the 3D button and friends) — and wire the two projects together
so `blank-slate-ui` is the ongoing **source of truth**. This is the styling foundation
for the `ui/redesign` branch. No page/layout or optimizer changes.

## Background

Both projects are Tailwind v4 + shadcn v4 on the same shadcn **"nova"** design, both
`neutral` base color, both Geist. They differ in exactly one thing: the **primitive engine**.

- **stat-builder** — `radix-nova` style, `radix-ui` primitives, default grayscale theme.
- **blank-slate-ui** — `base-nova` style, `@base-ui/react` primitives (v1.6), a customized
  blue-brand theme + a signature 3D button. It is a Vite + Storybook component library.

Base UI (from the creators of Radix + Floating UI + MUI) reached v1.0 in Dec 2025, is
shadcn-first-class, React-19-native, and is the primitive blank-slate-ui already uses.
Converging stat-builder onto Base UI lets components copy over verbatim and makes the
library a real design system.

The library's customization is concentrated: theme tokens + Button (3D), with light brand
tweaks on checkbox/switch/tabs; everything else is stock nova. Because stat-builder is
already nova, porting the **tokens** re-skins ~90% of the look for free — the only real
per-component work is the handful that are genuinely customized.

## Confirmed decisions

- **Adopt Base UI**, remove `radix-ui`. (`sonner` stays — it is a standalone toast lib,
  not a Radix/Base primitive.)
- **Connection = shadcn registry.** blank-slate-ui publishes; stat-builder pulls. This is a
  repeatable *pull* (copy), not a live import — it keeps shadcn's own-the-code freedom so
  per-app tweaks remain possible.
- **Hosting = raw GitHub.** Commit the built `public/r/*.json` to blank-slate-ui
  (branch `main`, public repo). Pull URL template:
  `https://raw.githubusercontent.com/NoahHendrickson/blank-slate-ui/main/public/r/{name}.json`
- **slider + toggle are authored in the library** (base-nova) so they ship from the one source.
- **Scope now:** port only the components stat-builder uses; pull the other six on demand.
- **Keep** `next/font` Geist and stat-builder's existing globals.css extras.

## Architecture

```
blank-slate-ui   ← authoring home + publisher
  ├─ src/components/ui/*.tsx    edit + test here (Storybook)
  ├─ registry.json             lists each component + a theme item
  └─ public/r/*.json           `shadcn build` output = the published registry (committed)
         │
         │   npx shadcn add @blank-slate/button --overwrite      (pull)
         ▼
stat-builder     ← consumer
  ├─ components.json  →  registries: { "@blank-slate": ".../r/{name}.json" }
  └─ src/components/ui/*.tsx    copies land here (still owned by this repo)
```

Registry namespace added to stat-builder's `components.json`:

```json
"registries": {
  "@blank-slate": "https://raw.githubusercontent.com/NoahHendrickson/blank-slate-ui/main/public/r/{name}.json"
}
```

## Part A — blank-slate-ui becomes the publisher

1. Add `registry.json` at the repo root:
   - One `registry:ui` item per component (button, badge, card, input, label, select,
     tabs, slider, toggle, plus the six extras), each declaring its `@base-ui/react`
     dependency and file path.
   - One `registry:theme` item (`@blank-slate/theme`) carrying the brand tokens via
     `cssVars` (`.theme` for the `--color-*` + font mappings, `.light` / `.dark` for the
     raw values): `--primary` (+fg), `--secondary` (+fg), `--accent` (+fg), `--brand`,
     `--brand-shadow`, `--neutral-line`, `--neutral-shadow`, `--radius: 0.5rem`, and the
     `--color-brand` / `--color-brand-shadow` theme mappings.
2. **Author `slider` + `toggle`** as base-nova components (Base UI ships `slider`, `toggle`,
   and `toggle-group`) with Storybook stories, matching the rest of the set.
3. Add a `"use client"` directive to the top of each interactive ui component. It is a
   no-op under Vite/Storybook, but is **required** once the file is pulled into a Next.js
   App Router (rsc) consumer — Base UI components are client components.
4. Build + publish: `pnpm dlx shadcn@latest build` → `public/r/*.json`; commit and push to `main`.

## Part B — stat-builder consumes + adopts Base UI

1. Dependencies: add `@base-ui/react`; remove `radix-ui`. Keep `sonner`.
2. `components.json`: `"style": "radix-nova"` → `"base-nova"`; add the `@blank-slate`
   registry (above); keep `"rsc": true`.
3. Pull from the registry (overwrites the `ui/` files + merges theme tokens):
   ```
   npx shadcn@latest add @blank-slate/theme @blank-slate/button @blank-slate/badge \
     @blank-slate/card @blank-slate/input @blank-slate/label @blank-slate/select \
     @blank-slate/tabs @blank-slate/slider @blank-slate/toggle
   ```
4. `globals.css` merge — the theme pull adds the brand tokens; **preserve** the
   `@custom-variant dark (&:where(.dark, .dark *))` variant, the number-input spinner
   block, the `--sidebar-*` tokens, and the `--font-sans: var(--font-sans)` wiring (do
   **not** adopt the library's `@fontsource-variable/geist`).
5. App-code refactors — the entire risk surface:
   - `src/components/auth/sign-in-card.tsx:46` & `:50` — `<Button asChild>` → Base UI
     `render` prop.
   - `src/components/builder/class-emblem-tabs.tsx:5` — direct `radix-ui` Tabs →
     `@base-ui/react/tabs` (List / Tab / Panel API).

## Ongoing workflow (the payoff)

Edit + test a component in blank-slate-ui (Storybook) → `pnpm dlx shadcn@latest build` →
commit/push → in any consumer: `npx shadcn@latest add @blank-slate/<name> --overwrite`.

## Verification

- Per `AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- blank-slate-ui: registry builds cleanly; `public/r/*.json` (and the `registry.json`
  catalog) are present and pushed.
- stat-builder: `npm run build` (next build), typecheck, and `npm test` (`vitest run`) all green.
- Visual pass: run stat-builder (`https://localhost:4321`) and compare button / tabs /
  inputs / slider / toggle against Storybook (`:6020`), in **light and dark**. Confirm the
  3D button lip renders correctly inside cards.

## Out of scope

- Any page/layout redesign; optimizer or data-model changes.
- The six on-demand components (dialog, popover, tooltip, checkbox, switch, accordion) until
  a redesign screen actually needs them.

## Risks / notes

- **`"use client"` is the main gotcha.** Base UI components are client components; the
  library's Vite sources omit the directive. Adding it in the library (Part A.3) keeps
  verbatim copies valid in the Next.js consumer.
- Base UI API differences beyond the two known sites are contained *inside* the pulled
  `ui/` files (self-contained), so app code that goes through the `ui/` wrappers is largely
  unaffected. The only reach-through is the emblem tabs.
- `shadcn add @blank-slate/theme` merges `cssVars` into `globals.css`; verify it appends and
  leaves the preserved blocks intact (manual fix if it clobbers anything).
- Ordering: Part A must be pushed before Part B can pull.
