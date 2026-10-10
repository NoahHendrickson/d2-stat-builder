# Branch performance audit and implementation plan

Date: 2026-09-29. Branch: `t3code/experiment-sidebar-layout`, starting HEAD `b07c1e5`.
Scope includes the existing uncommitted changes and untracked Manager implementation, compared with local `origin/main`. During the audit that work was committed externally as `03fe8f4`; subsequent Compare layout-only edits were also observed and left untouched. No application fixes were made by this audit. Measurements describe the working tree at build time, not a deployed release or those later layout edits.

The strongest opportunities are reducing Manager mount work, keeping the perk finder off the main thread, and removing the loading screen's artificial completion delay. Existing routing, data caching, and weapon search optimizations should be retained.

## Evidence and limitations

| Check | Result |
|---|---|
| Production build, Next 16.2.9 | Passed; all five UI routes statically prerendered |
| `npm test -- --reporter=dot` | 884 passed, 3 skipped; 97 test files passed, 1 skipped |
| `npm run bench:weapons` | Result parity passed for 12 scenarios / 1,340 catalog entries; original pipeline 1.10 ms/search, optimized warm pipeline 0.36 ms/search |
| Existing Chrome startup benchmark, production server | First builder results: cold 5,249 ms; warm 505 and 499 ms |
| Same startup runs, main-thread tasks over 50 ms | Cold: 2 tasks / 208 ms total / 134 ms maximum; warm: 2 / 156 / 88; warm repeat: 2 / 140 / 74 |
| Synthetic Manager vault, production Chrome | 800 vault items + 16 character tiles; 6,134 DOM nodes on direct entry |
| Manager return after visiting four other routes | Approximately 154 ms from scripted link click through route/content check and two animation frames |
| Immediate Manager revisit | Approximately 80 ms by the same method |

These are local diagnostic samples, not production percentiles. Startup uses the repository's synthetic 63-piece profile and near-instant stubbed session/profile responses, while manifest delivery is real. The navigation fixture duplicates armor items with unique instance IDs and the real vault bucket; it is not a representative mixed real account. Loadouts are empty in the navigation fixture. Navigation timings include polling/frame overhead and do not measure every image becoming ready. DOM counts include Activity-preserved hidden routes after navigation.

The existing startup harness's `ready at` detection can fire before hydration exposes the loading overlay. Its reported 29–62 ms readiness is **invalid as a usability metric** and is deliberately excluded. First-results detection is separate. Fix benchmark readiness detection before using it as a regression gate. Cross-origin worker table requests also do not all appear in its document resource list, so do not attribute the entire cold/warm difference to any single stage.

Initial script references in production HTML, deduplicated within each route:

| Route | JS chunks | Raw bytes | Sum of individually gzipped bytes |
|---|---:|---:|---:|
| `/` | 22 | 1,385,184 | 440,193 |
| `/armor` | 19 | 1,234,640 | 386,790 |
| `/manager` | 21 | 1,330,704 | 420,379 |
| `/loadouts` | 18 | 1,167,087 | 365,672 |
| `/weapons` | 20 | 1,282,076 | 405,133 |

These totals include shared framework code; they are not incremental tab-switch transfer sizes, deployment compression measurements, or a complete account of later dynamic chunks. Weapon catalog JSON is 1,764,515 bytes raw / 275,760 bytes gzip. Bundle attribution is needed before claiming a particular component accounts for a given saving.

## Findings, ranked

### 1. P1 — Perk finder can block the UI for seconds

**Evidence:** `src/components/manager/compare-drawer.tsx:134` calls `findPerkFinderResult` directly during render, regardless of `showFinder`. Annotation updates, stat sorting, and hiding the finder can repeat the calculation. `src/lib/inventory/perk-finder.ts:237` constructs the Cartesian product of selected column picks; lines 347–353 evaluate requirements against copies. The 200,000-step cover-search limit at line 436 does not bound that earlier work.

A seeded synthetic stress case with eight picks in each of five ranked columns produced 32,768 requirements: about **947 ms for 30 copies** and **2,239 ms for 60 copies** in Node, both returning `approximate: false`. Four picks per column produced 1,024 requirements and took about 19/35 ms. These are stress cases, not typical-user timings, but the render-blocking path is confirmed.

The saved reproduction is `/tmp/d2-performance-audit-20260929/perk-finder-bench.ts`; run it with `node_modules/.bin/tsx` from the repository root. A repeat measured 697/2,076 ms, confirming timing variability and the same scaling concern.

**Proposed change:** Cache by actual solver inputs, avoid recomputation while hidden, and run expensive calculations in a worker. Use request identities so an old result cannot replace a newer selection. Preserve the exact algorithm first; optimize it only behind result-parity checks.

**Correctness guard:** Preserve keep sets, ranking, tie breaks, combo semantics and the existing `approximate` flag. While inputs are pending, disable result-dependent junk tagging or explicitly retain the old result's input identity. Do not lower search budgets or silently discard combinations to make the UI faster.

### 2. P1 — Manager mounts the entire inventory

**Evidence:** `src/components/manager/manager-view.tsx:606` applies `content-visibility:auto`, but line 622 still creates every vault `ItemTile`. Each tile (`item-tile.tsx:42`) subscribes to move, annotation and search state and constructs images and overlays. The synthetic browser check confirmed 816 mounted tiles. CSS reduces offscreen layout/paint, not React mounting or subscriptions.

**Proposed change:** Virtualize responsive vault rows, with appropriate overscan, then evaluate whether character/account sections need similar treatment. Keep the existing tile memoization and selective subscriptions. First measure the React commit, layout and image costs separately so the implementation targets the actual bottleneck.

**Correctness guard:** Keep headings, totals, sorting/grouping, search highlighting, keyboard access, drag/drop hit areas, drag auto-scroll and open-item anchors correct. Offscreen inventory remains in the data model. Do not paginate or truncate the underlying inventory or calculations.

### 3. P2 — Loading screen adds a fixed delay and animates while invisible

**Evidence:** `src/components/loading/loading-screen.tsx:120` waits **400 ms after actual readiness** before setting `fading`; pointer interception ends only then (`:205`). The fade is 500 ms and removal occurs at 1,100 ms; this is not 1,100 ms of blocked input. The progress hook (`:28–56`) starts unconditionally. Signed-out/error states return `hidden`, never `done`, so the root-mounted component continues scheduling animation callbacks even after returning null at line 131. State eventually stabilizes, so this does not imply a React render every frame forever.

**Proposed change:** Release interaction on readiness, keep a short optional visual finish, and make animation lifetime follow visible loading state. Consider delaying overlay appearance for fast warm loads while retaining an accurate pending state.

**Correctness guard:** Keep the artwork, genuine loading/error states and accessibility semantics. Do not report live readiness merely because cached/provisional content exists. Cover sign-out, error recovery and direct public `/weapons` entry.

### 4. P2 — Mobile Weapons renders hidden desktop details

**Evidence:** `src/components/weapons/weapon-browser.tsx:577–593` hides the desktop details with CSS but still mounts `WeaponDetails`. Mobile selection mounts a second copy in the dialog (`:600`). The hidden copy builds perk UI, calculates display stats and subscribes to Clarity data. React Query deduplicates the fetch; the issue is duplicate component work, not necessarily duplicate network requests.

**Proposed change:** Use the existing `split` breakpoint state (`:356`) to mount the appropriate detail surface. Profile and, if useful, memoize/isolate `WeaponDetails` (`:157`) from parent virtualizer/search rerenders.

**Correctness guard:** Preserve selected weapon, perk previews, breakpoint transitions, focus return and hydration behavior. Verify that changing perks still updates displayed stats immediately.

### 5. P2 — Loadouts delays its UI chunk until data is ready

**Evidence:** `src/components/loadouts/loadouts-page-shell.tsx:24` defines a client-only dynamic list, but does not render it until armory and manifest are ready (`:56–62`). This creates a data-then-code dependency on direct entry. **Saved-loadout data already starts early** through `AppShell`'s `useLoadouts()`; do not add a second fetch or diagnose a data-request waterfall that is no longer present.

**Proposed change:** Start the list module load concurrently with authenticated route data, or on navigation intent, and keep optional editing surfaces split separately. Measure the current production waterfall before choosing placement. Manager's static imports of Compare and ItemDetails (`manager-view.tsx:60–61`) are another bundle-attribution candidate, not a measured byte-saving claim.

**Correctness guard:** Avoid moving the whole list/editor into the global bundle. Intent warming must not trigger mutations. Check cold first-open latency as well as initial route size; deferring every component can just relocate the wait to the user's next click.

### 6. P2 candidate — Manager rebuilds unchanged inventory after route eviction

**Evidence:** `src/lib/inventory/use-inventory.ts:24` uses hook-local `useMemo` for `buildInventory`. It survives a preserved route hide, but not eviction/remount. `build.ts:292–371` then rebuilds items, sorts buckets and calculates max power. The installed Next docs specify preservation of up to three routes; this app has five sidebar destinations. The observed 154 ms versus 80 ms return timings include several costs and do **not** isolate inventory derivation.

**Proposed change:** If stage timing confirms material cost, copy the nested identity-cache pattern already used by `deriveArmory` in `src/lib/armory/fetch.ts:93`, keyed by profile and manifest objects. Keep move/lock overlays separate.

**Correctness guard:** Test same-input reuse, changed profile, changed manifest, account switching and mutation settlement. Do not cache by route name or manifest version alone. Do not keep every route mounted indefinitely to avoid recomputation.

### 7. Follow-up candidates — measure before changing

- **Move update identity:** `src/lib/inventory/moves.ts:146` clones all inventory branches whenever operations exist, even for already-reflected moves. Copy-on-write could reduce downstream work; `mapItems` at line 278 is an existing identity-preserving pattern. Prioritize only if move traces show expensive rerenders. Preserve ordering, rollback, settlement and full-vault behavior.
- **Cold manifest delivery:** Downloading/parsing the full item table before projecting it remains necessary on the current cold path (`manifest/download.ts:106–144`), although parsing already runs in a worker. The branch's projection revision invalidation intentionally makes prior caches cold. Measure worker transfer/parse/cache-write/read stages. A version-matched preprojected artifact could reduce cold startup substantially, but needs separate design, field-completeness parity, atomic cache commits and full-download fallback. Do not serve an old snapshot as current or omit Manager/stat/socket fields.
- **Public Weapons startup:** Signed-in `/weapons` still starts shared armor/manifest work through the shell/loading subscribers even though catalog search is independent. Measure contention before changing scheduling; early warming also benefits later sidebar navigation. Signed-out users already skip manifest fetching.

## Implementation phases

### Phase 0 — Documentation discovery and baseline (partly completed)

Read the installed Next 16.2.9 guides before implementation; current web docs can describe a newer release. Allowed patterns and sources:

- Normal `next/link` and deliberate `router.prefetch()` intent warming: `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`. Automatic prefetch already runs in production.
- Cache Components / Activity: `.../02-guides/preserving-ui-state.md:19` and `.../03-api-reference/05-config/01-next-config-js/cacheComponents.md`. Effects clean up on hide and restart on show; only a limited number of routes stay preserved. [Official guide](https://nextjs.org/docs/app/guides/preserving-ui-state).
- Module-scope `dynamic(() => import(...))`, conditional loading and client-only `ssr:false`: `.../02-guides/lazy-loading.md`. Do not put `ssr:false` in a Server Component or assume a Server Component dynamic import produces the desired client split. [Official guide](https://nextjs.org/docs/app/guides/lazy-loading).
- `useVirtualizer`, `getScrollElement`, `estimateSize`, `overscan`, `measureElement`: copy existing usage from `loadouts-list.tsx:207` and `armor-table.tsx:439`; check the installed types and [official API](https://tanstack.com/virtual/latest/docs/api/virtualizer) for additional options.
- Worker lifecycle and stale-result sequencing: copy the existing patterns in `src/lib/optimizer/optimizer-store.ts:179,321,365`, `src/lib/optimizer/worker.ts` and `src/lib/manifest/download-worker.ts`, without sharing their domain-specific state.

Complete baseline: correct the readiness detector; capture at least 20 repetitions per navigation case, production builds, cold and warm cache, desktop and mobile widths, representative small/large fixtures, and throttled CPU/network. Record click-to-visible-content, interaction readiness, long tasks, React commits, network requests and heap after repeated five-tab cycles. Record Firefox scrolling separately.

**Verification:** Measurements must distinguish cached data from live readiness, immediate revisit from eviction, and public from authenticated paths. No production latency claims from dev-server compilation or synthetic API response time.

### Phase 1 — Remove avoidable startup and mobile work

Implement findings 3 and 4, using existing loading-state helpers and `useMinWidth` behavior. Keep visual design intact. Independently verify each change before combining.

**Verify:** No fixed 400 ms click block after readiness; no hidden indefinite progress loop; one active weapon detail tree at each breakpoint; unchanged stats/tooltips/selection. Re-run `loading/progress` and weapon display-stat tests plus browser focus/error checks. Use Phase 0 lazy-loading and layout references; do not add speculative global memoization.

### Phase 2 — Make Manager entry and revisits scale

Implement vault row virtualization from the existing virtualized lists, after profiling. Add shared immutable inventory derivation only if its measured contribution warrants it. Treat move structural sharing as a separate change, not a prerequisite.

**Verify:** Mounted vault tile count scales with viewport plus overscan; five-tab return gets faster; all items remain reachable; scroll and focus survive moves, search and resizing. Run inventory build/max-power/search/moves/lock tests. Compare full inventory results before/after. Preserve account isolation and live overlays.

### Phase 3 — Keep perk solving responsive without reducing accuracy

First memoize true inputs, then move the same solver to a worker with cancellation/stale-response handling based on the existing worker patterns. Keep the last result visibly associated with its input or show a pending state.

**Verify:** Exact keep sets, ranking and approximation flags match existing fixtures and stress cases; navigation/typing stay responsive during a long solve; older results never enable junk-tagging actions for newer picks. Run `perk-finder.test.ts` and add race/lifecycle tests that exercise result-dependent actions. A shorter timeout is not an accuracy-preserving fix.

### Phase 4 — Remove measured loading waterfalls

Use the documented client dynamic-import pattern to overlap Loadouts list code with its data. Attribute Manager optional code before splitting it, and warm optional modules on intent when necessary. If cold manifest stages dominate the remaining budget, write a separate versioned-artifact design before implementing that larger change.

**Verify:** Production network traces show overlap; first interaction remains fast; route JS bytes and cold/warm readiness improve. No extra profile requests, stale definitions, missing projections, or duplicate saved-loadout fetches. Keep freshness checks and atomic cache commits.

### Phase 5 — Regression verification and acceptance

Run build and the full suite once the implementation settles; repeat targeted tests after any subsequent change. Re-run weapon-search parity and optimizer result verification if shared inputs/normalization change. Audit proposed APIs against the installed docs.

Proposed performance targets, to calibrate against the Phase 0 device baseline: warm sidebar click-to-content p95 under 100 ms on the reference desktop and under 200 ms with a documented slower-device profile; no navigation-blocking perk-solver tasks; no app-owned repeated work over 50 ms during ordinary interactions; no continuous hidden-loader callbacks; stable memory after repeated navigation cycles. Cold startup gets a separate transfer/stage budget rather than a promise to hide necessary downloads.

Correctness acceptance includes identical optimizer/search results, accurate stats, live mutation rollback/settlement, account switching, manifest updates, share-link imports, keyboard access, responsive resizing, and unchanged visual quality. Include first opening of deferred dialogs, not just initial page load.

## Existing work to preserve

Keep automatic Link prefetching, Cache Components, persistent QueryClient, early session/profile fetching, warm manifest cache reads with background revalidation, worker-based manifest parsing, shared armory derivation, optimizer input deduplication (`optimizer-store.ts:277`), and existing Armor/Weapons/Loadouts virtualization. The audit does not justify a router rewrite, blanket loading boundaries, lower solver precision, or disabling freshness checks.

Audit-only browser/benchmark scratch files were kept under `/tmp/d2-performance-audit-20260929/`. Application source was not edited; this plan is the only intended repository addition.
