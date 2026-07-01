# Adopt Base UI via the blank-slate-ui registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin stat-builder with blank-slate-ui's style by converging it onto Base UI and consuming blank-slate-ui as a shadcn registry (the source of truth).

**Architecture:** blank-slate-ui becomes a shadcn *registry publisher* (component items + a theme item, built to `public/r/*.json`, served via raw GitHub on `main`). stat-builder switches its shadcn style to `base-nova`, pulls theme + components from that registry, swaps `radix-ui` for `@base-ui/react`, and refactors the two app-code sites that used Radix-specific APIs.

**Tech Stack:** Next.js 16 (App Router, RSC) + React 19 + Tailwind v4 + shadcn v4 (stat-builder); Vite + Storybook + Tailwind v4 + shadcn v4 (blank-slate-ui); `@base-ui/react` v1.6.

## Global Constraints

- Both repos are **Tailwind v4 + shadcn v4**. shadcn style is **`base-nova`**.
- stat-builder is **Next.js 16.2.9 / React 19 / App Router / `rsc: true`**. Per `AGENTS.md`: **read the relevant guide in `node_modules/next/dist/docs/` before writing any code.**
- Primitive is **`@base-ui/react@^1.6.0`**. **Remove `radix-ui`** from stat-builder (last step, once unreferenced). **Keep `sonner`** (standalone toast lib).
- Registry pull URL (public repo, branch `main`): `https://raw.githubusercontent.com/NoahHendrickson/blank-slate-ui/main/public/r/{name}.json`
- In stat-builder `src/app/globals.css`, **preserve verbatim**: the `@custom-variant dark (&:where(.dark, .dark *))` line, the `input[type="number"]` spinner block, the `--sidebar-*` tokens, and the `--font-sans: var(--font-sans)` wiring. **Do NOT** add `@fontsource-variable/geist` — keep `next/font` Geist.
- **`"use client"`** must be the first line of every interactive component in the library (inert under Vite/Storybook, required in the Next consumer).
- **Ordering:** all of Part A must be built and pushed to `main` before any Part B pull.
- stat-builder work stays on the local `ui/redesign` branch (no push). The only remote push is blank-slate-ui `main` in Task A3, which is **gated on explicit user approval**.

---

# Part A — blank-slate-ui becomes the publisher

Work in `/Users/noey/Developer/blank-slate-ui`.

### Task A1: Author slider + toggle, add `"use client"` to interactive components

**Files:**
- Create: `src/components/ui/slider.tsx`, `src/components/ui/toggle.tsx` (via shadcn CLI, base-nova)
- Create: `src/components/ui/slider.stories.tsx`, `src/components/ui/toggle.stories.tsx`
- Modify: `src/components/ui/{button,badge,input,select,tabs,accordion,checkbox,dialog,popover,switch,tooltip}.tsx` (prepend `"use client"`) + the two new files

**Produces:** a complete base-nova component set in the library, each interactive file starting with `"use client"`.

- [ ] **Step 1: Branch**

```bash
cd /Users/noey/Developer/blank-slate-ui
git switch -c registry-setup
```

- [ ] **Step 2: Pull slider + toggle from shadcn's public base-nova style**

`components.json` already has `"style": "base-nova"`, so the CLI fetches the Base-UI versions.

```bash
pnpm dlx shadcn@latest add slider toggle
```

- [ ] **Step 3: Verify both are Base UI single-file components**

```bash
grep -l "@base-ui/react" src/components/ui/slider.tsx src/components/ui/toggle.tsx
```
Expected: both paths listed.

- [ ] **Step 4: Prepend `"use client"` to every interactive component**

Adds the directive only to files that import `@base-ui/react` and lack it (skips `card.tsx`, `label.tsx`).

```bash
cd /Users/noey/Developer/blank-slate-ui/src/components/ui
for f in $(grep -lE "@base-ui/react" *.tsx | grep -v '\.stories\.'); do
  head -1 "$f" | grep -q '"use client"' || { printf '"use client"\n\n%s' "$(cat "$f")" > "$f"; }
done
grep -L '"use client"' $(grep -lE "@base-ui/react" *.tsx | grep -v '\.stories\.')
```
Expected: the final `grep -L` prints nothing (every interactive file now has the directive).

- [ ] **Step 5: Add Storybook stories for slider + toggle**

Create `src/components/ui/slider.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Slider } from "./slider"

const meta = {
  title: "Components/Slider",
  component: Slider,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Slider defaultValue={50} className="w-64" />,
}
```

Create `src/components/ui/toggle.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bold } from "lucide-react"
import { Toggle } from "./toggle"

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Toggle aria-label="Toggle bold">
      <Bold />
    </Toggle>
  ),
}
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/noey/Developer/blank-slate-ui && pnpm typecheck
```
Expected: passes (exit 0). If `toggle.tsx`'s single-toggle API differs (some base-nova toggles export only `ToggleGroup`), adjust the story import to match the actual export named in `toggle.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui
git commit -m "feat: add base-nova slider + toggle, mark components use client"
```

---

### Task A2: Author `registry.json` and build the registry

**Files:**
- Create: `registry.json` (repo root)
- Generates: `public/r/*.json` + `public/r/registry.json`
- Possibly modify: `.gitignore` (ensure `public/r` is tracked)

**Consumes:** the component files from A1.
**Produces:** built registry JSON at `public/r/`, each item carrying its `@base-ui/react` dependency; a `theme` item carrying the brand tokens.

- [ ] **Step 1: Create `registry.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry.json",
  "name": "blank-slate",
  "homepage": "https://github.com/NoahHendrickson/blank-slate-ui",
  "items": [
    {
      "name": "theme",
      "type": "registry:theme",
      "title": "Blank Slate Theme",
      "cssVars": {
        "theme": {
          "color-brand": "var(--brand)",
          "color-brand-shadow": "var(--brand-shadow)"
        },
        "light": {
          "primary": "#1e5fc8",
          "primary-foreground": "#ffffff",
          "secondary": "#e9f1ff",
          "secondary-foreground": "#0f2444",
          "accent": "#e9f1ff",
          "accent-foreground": "#0f2444",
          "ring": "#438eff",
          "brand": "#438eff",
          "brand-shadow": "#75bcff",
          "neutral-line": "#a1a1aa",
          "neutral-shadow": "#c9c9ce",
          "radius": "0.5rem"
        },
        "dark": {
          "primary": "#6ea8ff",
          "primary-foreground": "#08122b",
          "secondary": "#14233d",
          "secondary-foreground": "#e8f0ff",
          "accent": "#17294a",
          "accent-foreground": "#e8f0ff",
          "ring": "#75bcff",
          "brand": "#75bcff",
          "brand-shadow": "#2f6fd6",
          "neutral-line": "#6b6b73",
          "neutral-shadow": "#3f3f46",
          "border": "oklch(0.32 0 0)",
          "input": "oklch(0.37 0 0)"
        }
      }
    },
    { "name": "button",   "type": "registry:ui", "title": "Button",   "dependencies": ["@base-ui/react", "class-variance-authority"], "files": [{ "path": "src/components/ui/button.tsx",   "type": "registry:ui" }] },
    { "name": "badge",    "type": "registry:ui", "title": "Badge",    "dependencies": ["@base-ui/react", "class-variance-authority"], "files": [{ "path": "src/components/ui/badge.tsx",    "type": "registry:ui" }] },
    { "name": "card",     "type": "registry:ui", "title": "Card",     "files": [{ "path": "src/components/ui/card.tsx",     "type": "registry:ui" }] },
    { "name": "input",    "type": "registry:ui", "title": "Input",    "dependencies": ["@base-ui/react"], "files": [{ "path": "src/components/ui/input.tsx",    "type": "registry:ui" }] },
    { "name": "label",    "type": "registry:ui", "title": "Label",    "files": [{ "path": "src/components/ui/label.tsx",    "type": "registry:ui" }] },
    { "name": "select",   "type": "registry:ui", "title": "Select",   "dependencies": ["@base-ui/react", "lucide-react"], "files": [{ "path": "src/components/ui/select.tsx",   "type": "registry:ui" }] },
    { "name": "tabs",     "type": "registry:ui", "title": "Tabs",     "dependencies": ["@base-ui/react"], "files": [{ "path": "src/components/ui/tabs.tsx",     "type": "registry:ui" }] },
    { "name": "slider",   "type": "registry:ui", "title": "Slider",   "dependencies": ["@base-ui/react"], "files": [{ "path": "src/components/ui/slider.tsx",   "type": "registry:ui" }] },
    { "name": "toggle",   "type": "registry:ui", "title": "Toggle",   "dependencies": ["@base-ui/react", "class-variance-authority"], "files": [{ "path": "src/components/ui/toggle.tsx",   "type": "registry:ui" }] },
    { "name": "accordion","type": "registry:ui", "title": "Accordion","dependencies": ["@base-ui/react", "lucide-react"], "files": [{ "path": "src/components/ui/accordion.tsx","type": "registry:ui" }] },
    { "name": "checkbox", "type": "registry:ui", "title": "Checkbox", "dependencies": ["@base-ui/react", "lucide-react"], "files": [{ "path": "src/components/ui/checkbox.tsx", "type": "registry:ui" }] },
    { "name": "dialog",   "type": "registry:ui", "title": "Dialog",   "dependencies": ["@base-ui/react", "lucide-react"], "files": [{ "path": "src/components/ui/dialog.tsx",   "type": "registry:ui" }] },
    { "name": "popover",  "type": "registry:ui", "title": "Popover",  "dependencies": ["@base-ui/react"], "files": [{ "path": "src/components/ui/popover.tsx",  "type": "registry:ui" }] },
    { "name": "switch",   "type": "registry:ui", "title": "Switch",   "dependencies": ["@base-ui/react"], "files": [{ "path": "src/components/ui/switch.tsx",   "type": "registry:ui" }] },
    { "name": "tooltip",  "type": "registry:ui", "title": "Tooltip",  "dependencies": ["@base-ui/react"], "files": [{ "path": "src/components/ui/tooltip.tsx",  "type": "registry:ui" }] }
  ]
}
```

- [ ] **Step 2: Build the registry**

```bash
cd /Users/noey/Developer/blank-slate-ui && pnpm dlx shadcn@latest build
```
Expected: writes `public/r/theme.json`, `public/r/button.json`, … `public/r/toggle.json`, and `public/r/registry.json`.

- [ ] **Step 3: Verify output**

```bash
ls public/r
grep -q '@base-ui/react' public/r/button.json && echo "button OK"
grep -q '"brand"' public/r/theme.json && echo "theme OK"
```
Expected: 16 item files + `registry.json`; both `echo`s print OK.

- [ ] **Step 4: Ensure `public/r` is tracked (not gitignored)**

```bash
git check-ignore public/r/button.json && echo "IGNORED — fix .gitignore" || echo "tracked OK"
```
Expected: `tracked OK`. If `IGNORED`, add `!public/r/` to `.gitignore` and re-check.

- [ ] **Step 5: Commit**

```bash
git add registry.json public/r .gitignore
git commit -m "feat: publish shadcn registry (components + theme)"
```

---

### Task A3: Merge to `main` and push (GATED — needs user approval)

**Consumes:** the committed registry from A2.
**Produces:** the live raw-GitHub registry URLs that Part B pulls from.

- [ ] **Step 1: Get explicit user approval to push to the public `main` branch.** Do not proceed without it.

- [ ] **Step 2: Merge the branch into `main`**

```bash
cd /Users/noey/Developer/blank-slate-ui
git switch main
git merge --no-ff registry-setup -m "feat: publish shadcn registry"
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Verify the raw URL is reachable** (raw.githubusercontent may cache for a few minutes)

```bash
curl -sfI "https://raw.githubusercontent.com/NoahHendrickson/blank-slate-ui/main/public/r/button.json" | head -1
```
Expected: `HTTP/2 200`. If 404, wait ~1 min and retry.

---

# Part B — stat-builder consumes the registry + adopts Base UI

Work in `/Users/noey/Developer/stat-builder` on branch `ui/redesign`.

### Task B1: Add `@base-ui/react` and point components.json at the registry

**Files:**
- Modify: `package.json` (add `@base-ui/react`; **keep** `radix-ui` for now)
- Modify: `components.json` (style + registries)

**Consumes:** the live registry from A3.
**Produces:** `@base-ui/react` installed; `components.json` on `base-nova` with the `@blank-slate` namespace.

- [ ] **Step 1: Read the Next.js guides (AGENTS.md requirement)**

```bash
ls /Users/noey/Developer/stat-builder/node_modules/next/dist/docs/
```
Read the guides relevant to this change — client/server components and CSS/styling — before editing code.

- [ ] **Step 2: Install Base UI (leave radix-ui in place)**

```bash
cd /Users/noey/Developer/stat-builder
npm install @base-ui/react@^1.6.0
```

- [ ] **Step 3: Edit `components.json`** — change `style` and add `registries`:

```jsonc
// "style": "radix-nova"  ->
"style": "base-nova",
// add (sibling of "style"):
"registries": {
  "@blank-slate": "https://raw.githubusercontent.com/NoahHendrickson/blank-slate-ui/main/public/r/{name}.json"
},
```
Keep `"rsc": true` and everything else unchanged.

- [ ] **Step 4: Verify the app still builds (nothing behavioral changed yet)**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components.json
git commit -m "chore: add @base-ui/react and @blank-slate registry"
```

---

### Task B2: Refactor `class-emblem-tabs.tsx` to Base UI Tabs

This component reaches into the Radix Tabs primitive directly. Base UI's `Tabs.Root` keeps the same `value` / `onValueChange` API; only the import and the `Trigger`→`Tab` element name change. Doing this now (before the pull) keeps every commit building.

**Files:**
- Modify: `src/components/builder/class-emblem-tabs.tsx`

- [ ] **Step 1: Swap the import** (line 5)

```tsx
// - import { Tabs as TabsPrimitive } from "radix-ui";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
```

- [ ] **Step 2: Rename the trigger element** — in `EmblemTab`, change `TabsPrimitive.Trigger` to `TabsPrimitive.Tab` (both the opening and closing tags):

```tsx
    <TabsPrimitive.Tab
      value={String(character.classType)}
      aria-label={`${name}, Power ${character.light}`}
      className={cn(
        "relative h-14 flex-1 overflow-hidden rounded-md border text-left transition-all",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-primary ring-primary opacity-100 shadow-sm ring-2"
          : "border-border/60 hover:border-border opacity-80 hover:opacity-100",
      )}
    >
```
…and the matching closing tag `</TabsPrimitive.Tab>` at the end of that element.

- [ ] **Step 3: Update the stale doc comment** (lines 98–100) — it says "Built on the Radix Tabs primitive". Change "Radix" to "Base UI":

```tsx
 * Class selector rendered as Destiny emblem nameplates — one per class, pulled from
 * the player's own characters. Built on the Base UI Tabs primitive (matching the app's
 * shadcn Tabs) so keyboard navigation and tablist semantics come for free.
```

`TabsPrimitive.Root` (with `value` + `onValueChange`) and `TabsPrimitive.List` are unchanged — Base UI uses the same names.

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: both pass. (`@base-ui/react` is installed; `radix-ui` is still installed but this file no longer uses it.)

- [ ] **Step 5: Commit**

```bash
git add src/components/builder/class-emblem-tabs.tsx
git commit -m "refactor: emblem tabs use Base UI Tabs primitive"
```

---

### Task B3: Pull theme + components, preserve globals extras, refactor the asChild buttons

**Files:**
- Overwrite (pulled): `src/components/ui/{button,badge,card,input,label,select,tabs,slider,toggle}.tsx`
- Modify (merged): `src/app/globals.css`
- Modify: `src/components/auth/sign-in-card.tsx`

**Consumes:** the registry (A3). **Produces:** Base UI component set in `ui/`, brand theme in `globals.css`, no remaining `asChild` usage. Ends green.

- [ ] **Step 1: Snapshot the globals blocks we must preserve**

```bash
cd /Users/noey/Developer/stat-builder
grep -n "custom-variant dark\|input\[type=\"number\"\]\|--sidebar\|--font-sans: var" src/app/globals.css
```
Keep this output; Step 4 confirms these survive.

- [ ] **Step 2: Pull theme + the nine in-use components**

```bash
npx shadcn@latest add @blank-slate/theme @blank-slate/button @blank-slate/badge \
  @blank-slate/card @blank-slate/input @blank-slate/label @blank-slate/select \
  @blank-slate/tabs @blank-slate/slider @blank-slate/toggle --overwrite
```

- [ ] **Step 3: Verify the pulled components are Base UI and carry `"use client"`**

```bash
grep -rL "@base-ui/react" src/components/ui/{button,badge,input,label,select,tabs,slider,toggle}.tsx
head -1 src/components/ui/button.tsx
grep -rl "radix-ui" src/components/ui || echo "no radix in ui/ — OK"
```
Expected: first `grep -rL` prints nothing (all are Base UI); `head` prints `"use client"`; last line prints the OK message. (`card.tsx` legitimately has no primitive import.)

- [ ] **Step 4: Verify the preserved globals blocks survived; re-add any the theme pull dropped**

```bash
grep -q 'custom-variant dark (&:where(.dark, .dark \*))' src/app/globals.css && echo "dark variant OK"
grep -q 'input\[type="number"\]' src/app/globals.css && echo "number-input fix OK"
grep -q -- '--sidebar:' src/app/globals.css && echo "sidebar tokens OK"
grep -q -- '--font-sans: var(--font-sans)' src/app/globals.css && echo "font wiring OK"
grep -q -- '--brand:' src/app/globals.css && echo "brand tokens merged OK"
grep -q -- '--color-brand:' src/app/globals.css && echo "brand theme mapping OK"
```
Expected: all six `echo`s print OK. For any that did **not** print, restore it:
  - Dark variant (must sit right after the `@import`s, before `:root`): `@custom-variant dark (&:where(.dark, .dark *));`
  - Number-input block (unlayered, keep at end of file):
    ```css
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
    ```
  - Brand theme mapping (inside `@theme inline { … }`): `--color-brand: var(--brand); --color-brand-shadow: var(--brand-shadow);`
  - If `--font-sans: var(--font-sans)` was replaced with a literal font, restore it (and ensure no `@fontsource` import was added).

- [ ] **Step 5: Refactor the two `asChild` buttons in `sign-in-card.tsx`** — Base UI has no `asChild`; use the `render` prop. Replace lines 45–55:

```tsx
        {authed ? (
          <Button
            render={<a href="/api/auth/logout" />}
            variant="outline"
            size="lg"
            className="w-full"
          >
            Sign out
          </Button>
        ) : (
          <Button render={<a href="/api/auth/login" />} size="lg" className="w-full">
            {isLoading ? "Loading…" : "Sign in with Bungie"}
          </Button>
        )}
```

- [ ] **Step 6: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: both pass. If a pulled `<Tabs>` consumer fails typecheck, it is using a Radix-only prop — switch it to the standard `value`/`defaultValue`/`onValueChange` API (compatible across both).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui src/app/globals.css src/components/auth/sign-in-card.tsx
git commit -m "feat: pull Base UI components + brand theme from @blank-slate registry"
```

---

### Task B4: Remove `radix-ui` and run the full verification gates

**Files:**
- Modify: `package.json` (remove `radix-ui`)

- [ ] **Step 1: Confirm nothing imports radix-ui anymore**

```bash
cd /Users/noey/Developer/stat-builder
grep -rn "radix-ui" src && echo "STILL USED — stop" || echo "unreferenced — safe to remove"
```
Expected: `unreferenced — safe to remove`. If anything prints, refactor it to Base UI first.

- [ ] **Step 2: Uninstall**

```bash
npm uninstall radix-ui
```

- [ ] **Step 3: Full gates — build, typecheck, existing test suite**

```bash
npm run build && npx tsc --noEmit && npm test
```
Expected: build succeeds, no type errors, and `vitest run` is green (the migration must not regress the optimizer tests).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove radix-ui (fully migrated to Base UI)"
```

---

### Task B5: Visual verification pass (manual)

No code; this is the sign-off gate. The token/component look can only be confirmed visually.

- [ ] **Step 1: Run both apps**

```bash
# stat-builder (Terminal 1)
cd /Users/noey/Developer/stat-builder && npm run dev      # https://localhost:4321
# blank-slate-ui Storybook (Terminal 2)
cd /Users/noey/Developer/blank-slate-ui && pnpm storybook  # http://localhost:6020
```

- [ ] **Step 2: Compare, in both light and dark mode**, that stat-builder matches Storybook:
  - **Button** — the 3D blue face + shadow "lip"; the lip renders correctly **inside a Card** (sign-in card). Sign-in / sign-out render as real links (`<a>`), still full-width.
  - **Tabs** — the sliding brand indicator; the emblem class-selector still switches class.
  - **Input, Select, Slider, Toggle, Badge, Card** — palette + radius match the library.
  - Dark mode toggles cleanly (next-themes) with the darker brand tokens.

- [ ] **Step 3:** If anything is off, it is almost always a token that didn't merge (re-check Task B3 Step 4) or a component that wasn't pulled. Fix, re-run `npm run build`, and re-verify.

---

## Self-Review

**Spec coverage:**
- Adopt Base UI, remove radix-ui, keep sonner → B1 (add), B4 (remove). ✓
- Registry connection (publisher/consumer) → A1–A3 (publish), B1/B3 (consume). ✓
- Raw-GitHub hosting on `main` → A3, and the `components.json` registries URL in B1. ✓
- slider + toggle authored in the library → A1. ✓
- Theme travels via a registry `theme` item → A2 (cssVars), B3 (pull + preserve). ✓
- Preserve globals extras + keep next/font → B3 Step 4 + Global Constraints. ✓
- App refactors (2 asChild + 1 direct Radix Tabs) → B3 Step 5, B2. ✓
- `"use client"` gotcha → A1 Step 4, verified in B3 Step 3. ✓
- Read Next docs (AGENTS.md) → B1 Step 1. ✓
- Verification (build/typecheck/vitest/visual) → B4, B5. ✓
- On-demand six components published but not pulled → in `registry.json` (A2), excluded from the B3 pull. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real content; the one area of CLI-behavior uncertainty (how `shadcn add theme` writes vars) is handled by an explicit verify-and-restore step with exact snippets (B3 Step 4). ✓

**Type/name consistency:** Base UI Tabs API used consistently — `Tabs.Root` (`value`/`onValueChange`), `Tabs.List`, `Tabs.Tab` (B2). Registry namespace `@blank-slate` and the raw URL are identical in A3, B1, and B3. Component filename lists match across A2/B3. ✓
