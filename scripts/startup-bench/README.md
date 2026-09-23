# Startup bench

Times the signed-in load path (session → manifest → profile → first builds) in headless
Google Chrome over CDP, with `/api/auth/session` and `/api/bungie/profile` stubbed so no
Bungie sign-in is needed. Use it to compare two dev servers (e.g. `main` in a worktree on
another port vs. a branch) — the t3 preview webview throttles timers, so measure here.

```sh
node scripts/startup-bench/fixture.mjs                       # once: builds .profile.json from the live manifest
npm run dev                                                   # the server under test
node scripts/startup-bench/run.mjs https://localhost:4321/ /tmp/d2-startup-bench/chrome-profile fresh
```

`fresh` wipes the Chrome profile first (cold load: manifest download); omit it to reuse
the cache (warm load). Each invocation runs one cold/first load and two warm reloads and
prints, per run: when the loading overlay finished, when the first builds rendered, the
session/profile/manifest request timings, and main-thread long tasks. A screenshot of the
loaded builder lands in `/tmp/d2-startup-bench/builder.png`.

The stubbed profile answers in ~1 ms; a real GetProfile takes 300–1500 ms, so absolute
"ready" times here understate production but the comparisons hold.
