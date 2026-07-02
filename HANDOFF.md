# Stat Builder — Handoff

A Destiny 2 armor build optimizer. A player signs in with Bungie, sets targets for the six Armor 3.0 stats plus exotic / set-bonus / mod constraints, and the app searches **their own gear** and returns which armor pieces + mods to equip. Read-only (the player recreates the build in-game). Modeled on DIM's Loadout Optimizer and D2ArmorPicker.

**The user (Noah) is an expert D2 player and cross-checks results against D2ArmorPicker.** He is also the author of `dolores-lib` (see Gotchas). Trust his domain corrections.

---

## Quick start

```bash
npm run dev          # HTTPS dev server on https://localhost:4321 (Turbopack)
npx tsc --noEmit     # type-check (dev server hot-reloads; don't `npm run build` while dev runs)
```

- Sign in at `https://localhost:4321` (accept the self-signed cert). `.env.local` holds the Bungie app credentials (API key + confidential OAuth client id/secret). It's gitignored; `.env.example` documents it.
- **Port is 4321 over HTTPS** — the Bungie app's registered redirect is `https://localhost:4321/api/auth/callback`, and Bungie requires HTTPS.
- **You can't test inventory-dependent features yourself** (no Bungie session in a headless browser). The optimizer is a pure function — test it with Node scripts (see "Verification"). For anything reading real gear, hand a build to Noah to verify in his signed-in browser.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + **shadcn/ui** (radix-nova preset, Lucide, Geist), Turbopack. TanStack Query, `idb`, `bungie-api-ts`. Deploy target: Vercel.

---

## Status

| Milestone | State |
|---|---|
| M0 Scaffold | ✅ done |
| M1 Bungie OAuth (read-only) | ✅ done |
| M2 Manifest pipeline (IndexedDB cache) | ✅ done |
| M3 Inventory ingestion (incl. vault) | ✅ done |
| M4 Core optimizer + results UI | ✅ done |
| M5 Full constraints | 🟡 in progress — base stats ✅, mods ✅, set bonuses ✅, exotic selection ✅, tuning ✅, **fragments ✅** (tuning + fragments pending Noah's D2AP cross-check); artifice-in-optimizer ⬜ (gated behind a disabled "Use legacy armor" toggle — builds are Tier-5-only for now) |
| M6 Polish + deploy | ⬜ not started |

Full plan + verified Bungie/Armor-3.0 research: `/Users/noey/.claude/plans/i-want-to-create-snug-bumblebee.md`.

---

## Architecture map

```
src/
  app/
    page.tsx                         Main page: sign-in + manifest + armory + inspector + builder cards
    layout.tsx, globals.css          Root layout, dark theme (next-themes), Geist fonts
    api/auth/{login,callback,session,logout}/route.ts   OAuth flow
    api/bungie/profile/route.ts      Server-side GetProfile proxy (see Gotchas: Origin header)
  components/
    providers.tsx                    next-themes + React Query + Sonner (all in one 'use client' boundary)
    auth/sign-in-card.tsx
    manifest/manifest-status.tsx
    armory/armory-status.tsx         class×slot counts
    armory/piece-inspector.tsx       search a piece → computed stats (great for verifying stat math)
    builder/builder-panel.tsx        THE builder: class tabs, stat sliders, set-bonus grid, exotic select, mod slider, results
    ui/                              shadcn components (owned source; add more via `npx shadcn@latest add <name>`)
  lib/
    bungie/{constants,http,oauth,session}.ts   OAuth (confidential client), server-side token handling, HttpClient for bungie-api-ts
    manifest/{load,db,tables,use-manifest}.ts  download armor tables, IndexedDB cache keyed on manifest version
    armory/{fetch,normalize,stats,sets,use-armory}.ts   GetProfile → ArmorPiece[]; stat/slot/set constants
    optimizer/{types,solve,use-optimizer,worker}.ts     PURE solver + Web Worker wrapper
```

**Data flow:** browser → `/api/bungie/profile` (server calls Bungie) → raw `DestinyProfileResponse` → `normalizeArmory()` (client, needs manifest from IndexedDB) → `ArmorPiece[]` → `BuilderPanel` maps to `OptimizerPiece[]` → Web Worker `solve()` → ranked loadouts.

---

## Critical domain knowledge (hard-won — don't relearn it)

### The six Armor 3.0 stats (order + hashes, verified from live manifest)
`[weapons, health, class, grenade, super, melee]` — this order is used everywhere as `StatArray`.
Weapons `2996146975`, Health `392767087`, Class `1943323491`, Grenade `1735777505`, Super `144602215`, Melee `4244567218`. Range 0–200, **no tiers** (every point counts). See `src/lib/armory/stats.ts`.

### Stat math (this took several iterations — get it right)
- **Base roll = component 304 (current instanced stats) MINUS mods + tuning contributions.** Do NOT subtract masterwork. See `computeBaseStats()` in `normalize.ts`. Changeable plug categories stripped: `enhancements*` (mods/artifice), `tuning*`. Kept: `armor_stats`, `armor_archetypes`, `intrinsics`, masterwork.
- **Archetype stats are FIXED on Tier 5: primary 30, secondary 25, tertiary 20.** Masterwork does NOT change them. The other 3 (off-archetype) stats are 0 at base and get **+5 each from masterwork** (MW5).
- **⚠️ The manifest's masterwork plug lists its bonus as "+5 to all six stats," but the game caps the archetype — MW only actually adds +5 to the 3 off stats.** This is why we DON'T subtract masterwork (subtracting the manifest's +5 would corrupt the archetype down to 25/20/15). Instead `applyMasterwork()` assumes MW5 by setting the 3 lowest stats to ≥5. (Noah caught a bug here — an earlier version undervalued every piece by ~15.)
- **Exotics have no `armor_stats` plugs and no stats on the definition** — their stats exist only in component 304. The 304-minus-changeable approach handles them the same as legendaries.
- Masterwork is **assumed on for all pieces** (Noah's choice — you'd masterwork whatever you equip).

### Mods
Major +10, minor +5, artifice +3 (all to one stat; stack across pieces). **Up to 5 stat mods per loadout.** UI: user picks the number of major mods; the rest auto-fill as minor (`{major, minor: 5 - major}`). `assignMods()` in `solve.ts` finds the cheapest assignment covering stat deficits within budget. Verified in Node (a +10 gap needs a major; a single minor can't cover it).

### Set bonuses
Item → `DestinyInventoryItemDefinition.equippingBlock.equipableItemSetHash` → `DestinyEquipableItemSetDefinition` → `setPerks[]` (`{requiredSetCount: 2|4, sandboxPerkHash}`). Captured as `ArmorPiece.setHash`; resolved to names/perks in `sets.ts`. Optimizer guarantees ≥N pieces of a required set (`setRequirements`). **Not yet handled: wildcard sockets** — class items + exotics can count toward *any* set (per research); currently only exact `setHash` matches count.

### Exotic selection
Modes: `any` (≤1 exotic), `none`, `require` (exactly 1), `specific` (a chosen exotic). **The same exotic exists in multiple versions** (Armor 2.0 with an artifice slot vs Armor 3.0/T5 with tuning) — different `itemHash`, same name. The dropdown dedupes by **name**; `specific` matches **any** of that exotic's hashes (`ExoticConstraint.hashes`), and the optimizer picks the best version.

### Artifice
Detected via `ARTIFICE_PERK_HASH = 3727270518` in the piece's sockets → `ArmorPiece.isArtifice` (shown in the inspector). **The flag is captured but NOT yet used by the optimizer.** Armor 2.0 exotics and dungeon/Trials armor have artifice slots.

### Tuning (Tier-5) — data + model confirmed (Noah + live 310 probe)
- **Only Tier-5 armor tunes.** The tuning socket (index 11, plug category `core.gear_systems.armor_tiering.plugs.tuning.mods`) comes from component **310 (ItemReusablePlugs)** — re-added to the server-side GetProfile; it loads fine server-to-server (the old 500 was client-side only). Its available plugs reveal the instance's rolled **tuned stat** = the stat every directional plug adds +5 to. `computeTunedStat()` in `normalize.ts` → `ArmorPiece.tunedStat` (index 0–5); surfaced in the piece inspector.
- **Two tune types, auto-picked per piece by the optimizer:**
  - **Balanced** = **+1 to the 3 off-archetype stats ONLY** — NOT all six. Same masterwork gotcha: the manifest lists +1 to all six, but the archetype stats are capped, so only the 3 off-stats (the ones MW bumps to 5) actually move. (Confirmed by Noah — do not trust the manifest here.)
  - **Directional** = **+5 to the tuned stat, −5 to a chosen stat**, 0 energy.
- **All 5 pieces tune independently** — a full T5 loadout can stack 5 tunes.
- **Optimizer model (`solve.ts`):** every tunable piece takes Balanced (free off-stat upside); a directional is spent only to bridge a minimum Balanced can't reach. Fast path = Balanced-everywhere when it already meets the mins (O(pieces)); otherwise a branch-and-bound directional search **restricted to pieces tuned to a still-short stat** (a directional elsewhere is provably dominated by Balanced). `OptimizerPiece.tuning = {tuned, offStats}`; each `OptimizerLoadout` carries `tuning: (AppliedTuning|null)[]` + `tuningBonus`. Toggle via `OptimizerInput.allowTuning` (builder default on). Verified against a throwaway brute-force bench (matched exactly, 40/40) — perf ~ms on realistic tight-min queries, ~+12% over no-tuning on the pathological loose-min case.
- **Open question for Noah:** is the tuned stat always one of the 3 off-archetype stats? If a directional's +5 ever lands on a capped archetype stat, it'd be a no-op — validate in the inspector.

### Fragments (subclass) — implemented
- **Source:** stat-affecting subclass fragments are plug items in the manifest item table (kept by the `def.plug` filter). `availableFragments()` in `armory/fragments.ts` enumerates them by an explicit **plug-category → subclass** map and keeps only those with armor-stat `investmentStats`. ⚠ **Gotcha:** Stasis fragments use category **`shared.stasis.trinkets`** — not `.fragments`; a naive filter drops all of Stasis. (58 stat-affecting fragments across 6 subclasses; some hit multiple stats / exceed ±10, e.g. Whisper of Hunger `melee −20`.) Verified count-for-count against the live manifest.
- **Fragment data can be pulled without a signed-in session:** the item-definition JSON is public at `bungie.net/common/destiny2_content/json/en/…` (the app fetches manifest tables unauthenticated; only the version endpoint needs the API key). Handy for offline data spelunking.
- **Model:** the selected fragments' stats sum to one build-wide constant `OptimizerInput.fragmentBonus` (may be negative), folded into every loadout's effective stats **before** target checks — so targets are met *after* fragments, and a negative fragment raises the effective minimum. Reported `stats` include fragments; `baseStats` stays piece-only. Bench-verified vs brute force incl. negative cases. One active subclass at a time (only the active tab's selection applies); selection is class-independent.
- **UI:** `FragmentPicker` — subclass tabs + a Name-plus-6-stat-columns grid with toggles, in the "Fragments" section of the builder.

### Legacy armor / armor tiers
- The builder's candidate pool defaults to **Tier-5 only** = pieces with a tuning socket (`tunedStat !== undefined`). A disabled **"Use legacy armor"** toggle (Armor pool section) is the future opt-in for Armor 2.0 / artifice pieces — enabling it is blocked on artifice-in-optimizer support. Consequence today: Armor-2.0 exotics (no tuning socket) are excluded.

---

## What's left (do these, roughly in this order)

### 1. Tuning ✅ (implemented — pending Noah's D2AP cross-check)
Done end-to-end: 310 server-side → `computeTunedStat()` → `OptimizerPiece.tuning` → `solve.ts` (Balanced-default + directional-to-bridge) → `builder-panel.tsx` (toggle + per-piece tune in results). Full model + the **Balanced-caps-to-off-stats** gotcha (the original "+1 to a few stats" guess below was wrong) are under **Tuning (Tier-5)** in Critical domain knowledge. The notes below are the original research, kept for context.

**The data problem:** each piece's tuned stat is instance-specific and lives in the tuning socket's available plugs — component **`310` (ItemReusablePlugs)** — which **500'd when requested for the full vault client-side** (that's why it was dropped from `/api/bungie/profile`). Approaches, in order of preference:
  1. Re-add `310` to the **server-side** GetProfile (`api/bungie/profile/route.ts` COMPONENTS) and have Noah confirm his armor still loads — the 500 was client-side; server-to-server may handle the larger response.
  2. If that still 500s: fetch `310` in a **second, scoped** call (e.g. only the selected class), or chunk it, or use `Destiny2.GetItem` for the candidate set.
  The tuning socket's plug category is `core.gear_systems.armor_tiering.plugs.tuning.mods`; the tuned stat is revealed by which `+5 X / −5 Y` plugs are available in that socket for the instance.

**Optimizer model:** add `tuned?: StatKeyIndex` (and an `isTier5`/`canTune` flag) to `OptimizerPiece`. Extend `solve.ts` like the other constraints: at the leaf (or during mod assignment), each tunable piece may contribute **+5 to its tuned stat and −5 to a stat the optimizer picks** (choose the −5 to do least harm). Update the feasibility pruning (`canReachMin`) to include the max tuning upside. Record the applied tuning per loadout and show it in results. Add a Node bench proving results are achievable and constraints hold. (Follow the exact pattern used for `mods` / `setRequirements` / `exotic` — each was: extend types → extend `solve.ts` → Node bench → wire into `builder-panel.tsx`.)

### 2. Artifice +3 in the optimizer ⬜
`ArmorPiece.isArtifice` is already detected. Add `artifice: boolean` to `OptimizerPiece`; each artifice piece in a loadout grants a free **+3 to one stat**. Fold into `assignMods()` as an extra `+3`-per-artifice-piece budget (separate from the 5 general mods). Track artifice count in the recursion; include its upside in pruning. Node-test.

### 3. Fragments ✅ (implemented — pending Noah's D2AP cross-check)
Done: `armory/fragments.ts` → `OptimizerInput.fragmentBonus` in `solve.ts` → `FragmentPicker` in the builder. See **Fragments (subclass)** in Critical domain knowledge for the model + the `shared.stasis.trinkets` gotcha. Spec: `docs/superpowers/specs/2026-07-01-fragments-design.md`; plan: `docs/superpowers/plans/2026-07-01-fragments.md`. Left to confirm: Noah picks fragments and cross-checks a build's stats + the grid against the game / D2ArmorPicker.

### 4. Set-bonus wildcard sockets ⬜
Class items + exotics have a wildcard set socket that counts toward any set. Update the set-count logic in `solve.ts` (and `sets.ts` ownership counts) to treat those as satisfying any required set.

### 5. M6 — polish + deploy ⬜
Loading/skeleton/error/empty states; better result ranking (currently by total stats — consider wasted-points penalty like D2AP); result → in-game reproduction clarity (icons, mod/tuning to slot, masterwork note); Vercel deploy with the prod redirect registered in the Bungie portal; optional PWA/offline (manifest already in IndexedDB).

---

## Verification

- **Optimizer:** it's a pure function (`solve()` — no DOM). Write a throwaway `src/lib/optimizer/__bench.ts`, run `npx tsx src/lib/optimizer/__bench.ts`, then delete it. Every constraint so far was verified this way with synthetic data + a brute-force cross-check (pruned optimum must equal exhaustive optimum). Do the same for tuning/artifice.
- **Stat math / inventory:** you can't sign in. Use the **piece inspector** (search a piece → shows computed masterworked stats, raw in parens) and have Noah compare to the game / D2ArmorPicker. The stat display format is `masterworked (raw)`.
- **Reference:** D2ArmorPicker (`github.com/Mijago/D2ArmorPicker`) and DIM (`github.com/DestinyItemManager/DIM`) — Noah compares against D2AP.

---

## Gotchas / decisions

- **shadcn/ui, not dolores-lib.** The project originally used Noah's own `dolores-lib`, but its published v0.1.1 bundle throws `require("react")` in the browser (broken Vite/Rolldown packaging) and breaks Turbopack SSR. Switched to shadcn/ui. Don't reintroduce dolores-lib.
- **Bungie OAuth: no PKCE.** Confidential client; client secret + refresh token stay **server-side** (httpOnly cookies). Access token is minted server-side and never sent to the client.
- **Authenticated Bungie calls go through our server** (`/api/bungie/profile`), not the browser. A client-direct call hit `OriginHeaderDoesNotMatchKey` (Bungie's Origin check on authenticated browser requests); server-to-server sends no Origin header. Do NOT tell Noah to change the app's Origin Header — the server proxy is the fix.
- **Component `310` (ItemReusablePlugs) 500s on the full vault** — see Tuning above.
- **Vault items report the vault bucket**, not their armor slot — resolve the slot from `def.inventory.bucketTypeHash`, not the item's live `bucketHash` (see `normalize.ts`).
- **Manifest:** download per-table JSON (not the ~379MB aggregate); filter the item table to armor + plugs (~17k of ~39k); cache in IndexedDB keyed on the `version` string.
- **Web Worker** bundles fine with Turbopack via `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`. The worker is single-threaded and stateless — a message posted mid-solve queues *behind* the in-flight run, so `run()` in `use-optimizer.ts` terminates and recreates the worker when a solve is in flight (cheap; the pool is re-serialized every `postMessage` anyway). Keep that behavior if you touch the worker lifecycle.
- Memory notes live in `/Users/noey/.claude/projects/-Users-noey-Developer-stat-builder/memory/`.
