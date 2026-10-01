# Startup and navigation benches

Headless Google Chrome over CDP, with `/api/auth/session`, `/api/bungie/*`, and
`/api/loadouts` stubbed so no Bungie sign-in is needed (`cdp.mjs`). The t3 preview webview
throttles timers, so measure here. For numbers worth keeping, run against a production
build (`npm run build && npx next start -p 4400`): the dev server compiles on demand and
doesn't prefetch.

```sh
node scripts/startup-bench/fixture.mjs        # once: .profile.json (one Hunter, 63 armor pieces)
node scripts/startup-bench/fixture.mjs full   # once: .profile-full.json (3 characters, ~720-item vault)
```

Both fixtures are built from the live manifest (needs `NEXT_PUBLIC_BUNGIE_API_KEY` in
`.env.local`). Set `CHROME=/path/to/chrome` if Google Chrome isn't at its macOS path.

## Startup: `run.mjs`

```sh
node scripts/startup-bench/run.mjs http://localhost:4400/ /tmp/d2-startup-bench/chrome-profile fresh [--full]
```

Times the signed-in load path (session → manifest → profile → first builds). `fresh` wipes
the Chrome profile first (cold load: manifest download); omit it to reuse the cache. Each
invocation runs one cold/first load and two warm reloads and prints, per run:

- **ready**: the data is in and the app takes clicks (the overlay lets them through)
- **uncovered**: the loading overlay has faded, so the content is actually visible
- **first results**: the first builds are on screen

plus the session/profile/manifest request timings and main-thread long tasks. A screenshot
of the loaded builder lands in `/tmp/d2-startup-bench/builder.png`.

The stubbed profile answers in ~1 ms; a real GetProfile takes 300–1500 ms, so absolute
"ready" times here understate production but the comparisons hold.

## Navigation: `nav.mjs`

```sh
node scripts/startup-bench/nav.mjs http://localhost:4400 [--small] [--mobile] [--cpu=4] [--cycles=5]
```

With the app loaded and warm, clicks through the sidebar and times each view from the
click, in three cases: the **first** visit (mount, code already prefetched), a visit
while **cycling** through all five views (the router keeps only a few mounted, so these
include remounts), and a straight **revisit** (the view was only hidden). Two times per
click:

- **content**: the view's content is in the DOM
- **clear**: and nothing is still fading it in

It also reports what the Items page mounts (tiles, DOM nodes, images) and the heap before
and after the cycles. `--mobile` runs at 390x844 through the menu drawer, `--cpu=4`
throttles the main thread (roughly a mid-range phone), `--small` uses the 63-piece fixture.
Navigations render as transitions in small slices, so "longest task" is often 0 even for a
slow mount; go by the content time.
