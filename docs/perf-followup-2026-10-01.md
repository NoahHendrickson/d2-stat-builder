# Performance follow-up — 2026-10-01

Review of the six-phase plan that followed `performance-audit-2026-09-29.md`: each claim
checked against the code and measured, then implemented where the numbers supported it.
Branch `t3code/experiment-sidebar-layout`, starting at `b767e87`.

## How it was measured

Production build (`next build`, `next start`), headless Chrome 154 on this machine
(M-series Mac), session/profile/loadouts stubbed, manifest real. Fixture: `.profile-full.json`
(three characters with full slots, 723 vault items, 70 account stacks). Warm cache unless
noted. "CPU x4" is Chrome's main-thread throttle, standing in for a slower device. The
tools are in `scripts/startup-bench/` (see its README); `nav.mjs` is new.

Not measured: Safari and Firefox (no Firefox on this machine; Safari isn't scriptable
this way), real devices, real network latency, a real account. Headless Chrome paints in
software, so nothing here says anything about GPU cost.

## Results

Warm navigation, ms from the click until the view is fully visible (p50; p95 where it differs much):

| View | Desktop before | Desktop after | CPU x4 before | CPU x4 after | Phone width, x4 before | after |
|---|---:|---:|---:|---:|---:|---:|
| Stat optimizer | 229 | 59 | 335 | 146 | 296 | 116 |
| Armor table | 187 | 35 | 253 | 73 | 255 | 85 |
| Weapon search | 198 | 32 | 236 | 57 | 221 | 51 |
| Loadouts | 184 | 24 | 186 | 27 | 205 | 32 |
| Loadouts, first visit | 322 | 35 | 335 | 34 | 340 | 43 |
| Items (remount) | 315 | 74 | 656 (p95 753) | 185 (p95 201) | 692 | 172 |
| Items, first visit | 331 | 87 | 796 | 225 | 718 | 211 |
| Items, straight back | 233 | 38 | 336 | 64 | 273 | 68 |

| Other | Before | After |
|---|---:|---:|
| Items page mounted (desktop): tiles / DOM nodes / images | 1,069 / 8,722 / 3,534 | 356 / 3,259 / 1,207 |
| Vault tiles mounted, of 793 | 793 | 80 (at most ~140 while scrolling) |
| Warm startup: data ready → content visible | 250 → 759 ms | 250 → 377 ms |
| Loader shown when leaving /weapons after the data was ready | yes | no |
| Weapon list scroll, script time over 240 frames (x4) | 2,007 ms | 985 ms |
| Double-click equip from the vault, script time (x4) | 168 ms | 102 ms |
| Heap after five trips round every view | 71.9 MB | 63.3 MB |

Against the plan's targets: warm navigation is under 100 ms on desktop for every view
(worst p95: Items, about 80 ms) and under 200 ms at CPU x4 except Items on a remount (p95
201 ms) and on its first visit (225 ms). What's left of the Items cost is the character
grid: 276 tiles that are all on screen at desktop width. Heap is flat across repeated
cycles (63.3 MB after 5, 64.3 MB after 12).

## The plan's claims

**Phase 1, confirmed and fixed.**
- The page fade (opacity 0 → 1 over 200 ms on every view change) was the largest part of
  every warm navigation: content was in the DOM at 20–65 ms and not fully visible until
  185–230 ms. Removed. (It had been added the day before, with the sliding nav highlight;
  the highlight stays.)
- The loader held the app covered for 150 ms after the data was ready and then faded for
  500 ms. It now starts a 200 ms fade at once, the bar sweeping to 100% as it goes.
- Settings waited behind the loader although it only reads device preferences. It is now
  exempt, like /weapons.
- Found while checking that: the loader's finish played whenever "done" was reached with
  the overlay down, so landing on /weapons signed in and then clicking another view
  flashed the full-screen loader over a ready app. The finish now only plays for an
  overlay that was actually up.
- Not done: delaying the overlay so fast warm starts never show it. The overlay is in
  the prerendered HTML, so it is the first paint; hiding it for a few hundred ms would
  show the half-loaded shell in its place.

**Phase 2, confirmed and done.** The vault mounted every tile; `content-visibility` only
saved paint, and without an intrinsic size it made the scroll height jump as rows came in.
The vault is now laid out in JS (`src/lib/inventory/vault-layout.ts`) and only the lines
near the viewport are mounted. Checked in the production build:
- Layout parity: every tile, marker, and heading sits at the same pixel as before in 25
  combinations (five widths from 390 to 1920 px, five sort/group/tab settings).
- Tabs, search dimming (including tiles mounted later), Tab order, Enter-to-open, the item
  panel staying anchored through a scroll, drag and drop with a scroll mid-drag, resize,
  and the stacked layout below `xl` where the page scrolls instead of the pane.
- The inventory itself is untouched, so totals, search, and bulk actions see every item.

**Phase 3, one of three done.**
- Weapon details re-rendering with the list: confirmed (about half the script time of a
  scroll). `WeaponDetails` is memoized; nothing else needed it.
- Backdrop blur on the armor table header and the loadout editor: left alone. Both are
  deliberate looks, the plan asks for a Firefox measurement first, and that can't be done
  here.
- `applyMoves` copying every branch: true, but a move costs ~40 ms of script in total and
  less now that the vault is windowed. Not worth the risk to move ordering and rollback.

**Phase 4.**
- Route prefetch on phones: confirmed gap. Below the sidebar breakpoint the nav links
  only exist while the drawer is open, so nothing was prefetched until then (0 requests,
  against 23 on desktop). The shell now prefetches the same views when idle.
- Loadouts' list chunk: a first visit sat on the placeholder for ~320 ms even with the
  chunk in memory, because the lazy wrapper always suspends once and React holds a
  placeholder for 300 ms. The shell warms the chunk when idle and the page renders the
  loaded component directly.
- Signed-in startup work on /weapons: measured, not worth deferring. The list appears at
  the same time signed in or out (~350 ms warm); the cost is one ~60 ms long task, and
  deferring it would move the wait to the next click.
- Cold manifest: the item table is 199 MB of JSON (8.6 MB gzipped on the wire), 460 ms to
  parse and 210 ms to project in Node, in a worker. Projected, it is 27.8 MB (3.4 MB gzip,
  1.5 MB brotli). A version-matched pre-projected artifact would cut the cold download by
  5x or more and skip the parse, which matters most on phones. It needs somewhere to build
  and host it per manifest version; not started.

## Still open

- Scroll position inside a view (vault, armor table, weapon list) is lost when you switch
  views and come back: a hidden view is `display: none`, which resets its scrollers. This
  was already so before these changes.
- Firefox and Safari timings, and the blur question above.
- The Items character grid, if phones need Items under ~150 ms.
- The pre-projected manifest artifact.
