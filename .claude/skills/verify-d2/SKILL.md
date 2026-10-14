---
name: verify-d2
description: Drive D2 Conflux (this repo's Next.js app) signed in, in headless Chrome against a stubbed backend, and capture proof that a user-facing feature works — stat optimizer, Dream build, saved loadouts, Items/manager, weapon search, armor table, settings. Use after changing UI or client behavior, before saying a feature works, or when asked to verify, smoke-test, or screenshot the app signed in.
---

# verify-d2

Proves D2 Conflux behavior the way a user would see it: start the app from this checkout, check the instance is worth driving, run a journey that clicks through a feature by ARIA role and accessible name, and keep screenshots, accessibility snapshots, and every API request as evidence.

Every `/api/*` call is answered inside the browser by an in-memory stub (`scripts/browser/stub.mjs`), so a run never signs in to Bungie, never writes to Neon, and never posts to Discord. The session is a fake "Verify Guardian", and the profile is the synthetic fixture from `scripts/startup-bench/fixture.mjs`. The real network is used only for the public bungie.net manifest and icons and for the Clarity perk feed.

The browser driver, the stub, and the route table live in `scripts/browser/` and are shared with the startup and navigation benches (`scripts/startup-bench/`); the skill adds the server lifecycle (`scripts/lib/server.mjs`), the journey harness (`scripts/lib/journey.mjs`), and the CLI.

All commands run from the repo root. The CLI is `.claude/skills/verify-d2/scripts/verify-d2`; below it is written as `verify-d2`.

## Rules

- Never drive the user's own Chrome, screen, or dev server (`https://localhost:4321`). `up` builds and serves a separate instance on its own port, and every run uses its own headless Chrome profile.
- Drive only an instance that `doctor` passed since it last surprised you. After a failed drive, run `doctor` again before the next one.
- One prod server per checkout. Agents in the same checkout share it: every run gets its own Chrome and its own stub, so runs don't see each other's state. `up` refuses a second prod server there (it would rebuild `.next` under the first). A different checkout needs a different port: `--port 4410`, passed to every command.
- A stubbed backend proves the client: what it renders, what it sends, and how it handles the answers. It doesn't prove what Bungie or the database do with those requests. Say so when you report a write as verified, for example "the client sent the right `apply-loadout` request; untested against a real account."

## Launch

```sh
.claude/skills/verify-d2/scripts/verify-d2 up            # next build + next start on :4400 (~20 s build)
.claude/skills/verify-d2/scripts/verify-d2 up --dev      # next dev on :4400 instead (hot reload, slower first loads)
```

- **Prod (the default):** `up` runs `next build`, then `next start`. It is as close to production as this gets, it catches type errors, and it can run in the main checkout while the user's `next dev` is up. `next dev` writes `.next/dev`; the prod build writes `.next`.
- **Ready:** `up` returns only after all six routes (`/`, `/armor`, `/weapons`, `/loadouts`, `/manager`, `/settings`) answer 200 with HTML. It prints `ready at http://localhost:4400`.
- **Rebuild after editing source:** a prod instance serves the build it started with. `doctor` fails with "build is stale" once source differs; then run `down` and `up` again.
- **`--dev`:** refuses to start when another `next dev` already serves this checkout, because the two would share `.next/dev`. Use it in a worktree to iterate quickly.
- **Worktrees:** a T3 worktree has no `node_modules` or `.env.local`. `up` symlinks the main checkout's copies (verification scaffolding; `down` removes them) and builds with `--webpack`, because Turbopack rejects a symlinked `node_modules`.
- **Fixtures:** `scripts/startup-bench/.profile.json` (small: 1 Hunter, 63 armor pieces) and `.profile-full.json` (3 characters, about 720 items) are gitignored. A worktree borrows the main checkout's. To build them, run `node scripts/startup-bench/fixture.mjs` and `node scripts/startup-bench/fixture.mjs full`; both need `NEXT_PUBLIC_BUNGIE_API_KEY` in `.env.local`.

## Doctor

```sh
.claude/skills/verify-d2/scripts/verify-d2 doctor        # read-only; exit 1 on any FAIL
```

It checks the following:
- The recorded server is alive.
- Every listener on the port is in our process group.
- The server's working directory is this checkout.
- In prod, the build matches the current source.
- `/` answers 200.
- Chrome exists and both fixtures exist.
- `.env.local` has the API key, and the bungie.net manifest answers.
- No Chrome from an earlier run is still running.

Run it before the first drive, after any failed drive, and whenever something looks off.

## Drive

```sh
.claude/skills/verify-d2/scripts/verify-d2 run optimizer      # one journey (journeys/optimizer.mjs)
.claude/skills/verify-d2/scripts/verify-d2 run all            # every journey, each in its own browser
.claude/skills/verify-d2/scripts/verify-d2 run /tmp/x.mjs     # an ad-hoc journey file
.claude/skills/verify-d2/scripts/verify-d2 list               # journeys, servers, last 10 runs
```

The runner prints each step and expectation as it runs and exits 0 only if every step passed. Each journey starts from nothing: a fresh Chrome profile with no IndexedDB caches, and a fresh stub store holding only the journey's seed. A failed step saves `NN-failure.png` and `NN-failure.aria.txt`. Read the `.aria.txt` first: it shows the role/name tree the step was searching.

**Writing a journey.** A journey is an ES module. `meta` is optional. The default export receives the helpers listed below.

```js
export const meta = {
  fixture: "full",                 // "full" (default) or "small"
  width: 1600, height: 1000,       // default; below 1024 the sidebar becomes a drawer, below 768 the "phone" layouts
  profile: (profile) => profile,   // reshape the parsed fixture for this journey only (e.g. add a duplicate)
  seed: (profile) => ({            // the stub's starting store, built from the (reshaped) fixture
    loadouts: [/* SavedLoadout rows with UUID ids */],
    settings: { links: { value: [], updatedAt: 0 } },
    usage: { "<64-hex query key>": [["<instance id>", 1]] },   // one record per optimizer query
  }),
};
export default async function ({ page, app, stub, step, shot, expect, log }) {
  await step("lo-edit: renaming saves", async () => {
    await app.open("/loadouts");                                     // load the route and wait until it's usable
    await page.click({ role: "button", name: "Actions for Raid build" });
    await page.click({ role: "menuitem", name: "Edit" });
    await page.fill({ role: "textbox", name: "Loadout name" }, "v2", { within: { role: "dialog", name: "Edit loadout" } });
    await page.click({ role: "button", name: "Save changes" });
    await app.toast(/Loadout updated/);
    expect(stub.last("PUT", "/api/loadouts/")?.body?.loadout?.name === "v2", "PUT carried the new name");
    await shot("edited");
  });
}
```

- **Targets:**
  - `{ role, name }` finds elements in Chrome's accessibility tree. A string `name` matches whole names, ignoring case and extra spaces (CSS `text-transform` leaks into names: "Save" can be "SAVE"). A RegExp `name` is tested against the raw name.
  - Add `nth` to pick one of several matches. Pass `{ within: target }` to search inside one element.
  - `{ css }` is the fallback for elements with no role or name (table rows, `[aria-label="Vault"]`).
  - Only elements a sighted user could see match: screen-reader-only (1 px or clipped), `opacity: 0`, and `visibility: hidden` boxes don't. Elements scrolled out of view do (clicks scroll them in). A target that matches more than one element throws unless you give `nth`.
- **`page`:**
  - Input: `click(t)`, `hover(t)`, `fill(t, text)` ("" clears), `type(text)` into the focused element, `press(key)` with `Enter`, `Escape`, `Tab`, `Backspace`, `Space`, arrows, `Home`, `End`, a digit or a letter.
  - Waiting: `waitFor(t | fn, { gone, timeout })`, `waitForText(re, { within })`.
  - Reading: `name(t)` (accessible name), `text(t)` (innerText), `attr(t, "aria-pressed")` (`getAttribute`), `value(t)` (a control's current value), `count(t)`, `exists(t)`, `findAll(t)`, `evalJs(expr)`.
  - Navigation: `goto(url)`; prefer `app.open(route)`.
  - Touch: `emulatePointer("coarse" | "fine")` turns on Chrome touch emulation, so `(pointer: coarse)` matches.
  - Evidence: `screenshot(file, { within })` and `aria({ within })`.
  - Clicks are real mouse events at the element's centre. A click that would land on a different element (an overlay, a toast) throws instead of going through.
- **`app`:**
  - `open(route)` waits for the loader to go and for the route's own content (its marker in `scripts/browser/routes.mjs`).
  - `nav(route)` clicks the route's link in the desktop sidebar and waits for its content.
  - `toast(rx)` waits for a toast whose title matches and returns it; `toasts()` lists the current titles.
- **`stub`:**
  - `requests`: every `/api` call as `{ method, path, body, status }`. `writes()` returns the non-GET ones; `last(method, pathPrefix)` the latest matching one.
  - `store`: `loadouts` (Map by id), `settings`, `usage` (Map by query key), `ingameSlots`. Bodies the real route would reject get a 400, as they would there.
  - `user`: the fake session's user.
- **`step(label, fn)`:** name a step after its feature-map sub-feature ID (`lo-edit: …`).
- **`shot(label, { within })`:** saves a PNG and an accessibility outline as a pair.
- **`expect(cond, msg)`:** throws when `cond` is false, and logs a ✔ line when it holds. Only call it on a condition that can fail: a `waitFor` that already passed is the check itself, so assert the state it led to (`attr`, `exists`, a request) or just `log`.
- **Waiting:** wait for end states. Don't sleep. Searches are debounced and run in workers. The page's state is right only after the value, the result, or the busy flag has changed, so poll for that change.

## Evidence

Each run writes `/tmp/verify-d2/runs/<YYYYMMDD-HHMMSS>-<journey>-p<port>-<pid>/` with these files:
- `steps.log`: steps, expectations, and outcomes.
- `NN-<label>.png` and `NN-<label>.aria.txt`: what the user saw, and the role/name tree they could act on.
- `api.json`: every `/api` request with its body and the stub's status. This is how side effects are proven (`POST /api/loadouts` carried the name; `POST /api/bungie/move` went vault → character).
- `console.txt`: console errors, warnings, and uncaught exceptions.
- `summary.json`: pass or fail, error, writes, unstubbed calls, stub errors, the server's source stamp, and the evidence list.

What counts as proof:
- Drive the user path: click the button, type in the box. Don't call internal setters or set React state.
- Capture the action and the state it produces, not only the final screen.
- Show a write twice: once in `api.json`, and once in a second view that renders it. For example, the saved loadout appears on `/loadouts`; the edited name appears on the card.
- A journey that passes with `unstubbed` calls or `stubErrors` in its summary hit routes the stub doesn't know (501) or bodies it choked on (500). Fix `scripts/browser/stub.mjs` before trusting the result.

## Cleanup

```sh
.claude/skills/verify-d2/scripts/verify-d2 down          # add --port N if you used one
```

`down` stops the process group that `up` started. It never matches processes by name. It also removes the scaffolding symlinks; if another verify server in the same checkout is still up (a `--dev` beside a prod one), the links pass to it and its `down` removes them. It stops Chrome left behind by runs that died: each profile under `/tmp/verify-d2/chrome/` records its Chrome pid and the pid of the process driving it, and only Chrome whose driver is gone is stopped, so other agents' live runs are safe. Each run already closes its own Chrome and deletes its profile, even when the run fails. Nothing deletes `/tmp/verify-d2/runs/`: evidence survives cleanup. A failed `up` cleans up after itself.

## Feature map

`features/README.md` indexes one file per feature. Each file lists the feature's sub-feature IDs, the user's entry points, the recipe with exact handles, and its gotchas. `journeys/<feature>.mjs` is that recipe, made executable. Read the matching feature file before you drive a feature or change its journey, and update both when the app changes. When a journey fails, decide whether the map drifted (fix the map and journey) or the app regressed (report it; don't weaken the journey to pass).

## Gotchas

- **Accessible names follow CSS text-transform**, and `innerText` does too ("MASTERWORK", "SAVE AS LOADOUT"). String names already ignore case. Use `/…/i` when matching text.
- **Screen-reader-only text breaks `innerText`:** a count like "1,335 weapons" spans two lines there. Read the element's `page.name()` instead.
- **Toasts are `dialog` elements** inside the `region "Notifications"`. Don't search for "any dialog named /clear/" when a toast with that word may be up.
- **Table rows have no accessible name.** Use `{ css: "table tbody tr" }` and read the cells.
- **Fixture limits:**
  - Armor has no sockets, so stat mods show "not slotted" and saved-loadout stats leave out mods.
  - Instance IDs are `instN`, not numeric.
  - There is no duplicate armor (`armor.mjs` adds one with `meta.profile`).
  - The profile never changes after a write; the app's optimistic state is what renders.
- **The first build card changes between runs** while background refinement settles. Assert properties that hold for every card ("Health ≥ 100 on every card"), not the identity of a particular card.
- **A dev instance serving stale CSS** after `globals.css` edits needs `down`, `rm -rf .next/dev`, then `up --dev`. Prod builds don't have this problem.
- **Manifest downloads:** every run downloads the manifest again from bungie.net (fresh profile), which takes about 2–5 s. A bungie.net outage fails `doctor` and every run.
