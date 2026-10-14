# D2 Conflux verification map

This directory is the maintained source for verifying what a signed-in user can do in D2 Conflux. Read this index before you drive the app. Then use the matching feature file as the recipe, and its `journeys/<feature>.mjs` as the executable version.

## Baseline preconditions

- `verify-d2 up` is serving this checkout at `http://localhost:4400` (or the `--port` you chose), and `verify-d2 doctor` passed.
- The session is stubbed as `Verify Guardian` (membershipId `verify-user`). The profile is the `full` fixture (Hunter, Titan and Warlock, all Power 450, about 720 items) unless the journey asks for `small` (one Hunter, 63 armor pieces).
- Every `/api/*` request is answered by `scripts/browser/stub.mjs`. Nothing reaches Bungie writes, Neon, or Discord.
- Each run starts from a fresh Chrome profile at 1600×1000 with the What's new dialog marked as seen.

## Driving conventions

- Start every recipe from `app.open(<route>)` unless its preconditions say otherwise.
- Find elements by role and accessible name. Use `{ css }` only where the app gives no role or name, and the feature file says where.
- Treat names and commands as literal. String names ignore case; regexes don't.
- At 1600 px with the sidebar open, the Items page is in its compact layout: one character at a time, chosen with tabs.
- Wait for end states: a value changed, a busy flag cleared, a request recorded. Don't sleep for a fixed time.

## Proof and skip reporting

- Capture the user action and the resulting state: `shot()` after the action, not just at the end.
- Prove a write twice: once by the request in `api.json`, and once by a second user-facing view that shows its result.
- Record every artifact under the sub-feature ID it proves (the `step()` label starts with it).
- Report an unreachable sub-feature with the route you attempted and the precondition that wasn't met. Never report it as verified through a different path.
- A stubbed write proves the client, not Bungie. Write it up as "client sent X; untested against a real account."

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the behavior a user sees. It then has exactly four H2 sections, in this order:

1. `Sub-features` lists short IDs, one line each.
2. `How to get to it (user POV)` lists every entry point.
3. `Driving it with verify-d2` starts with `Preconditions:`, then pairs each user action with exact handles and the result you can observe.
4. `Gotchas` lists the traps that waste a run or invalidate its proof.

## Features

- [Stat optimizer](./optimizer.md): targets, results, opening a build, Dream build, Save as loadout. Journey: `optimizer`.
- [Saved loadouts](./loadouts.md): search, edit, equip (apply stream), save in-game, delete, delete all. Journey: `loadouts`.
- [Items (manager)](./manager.md): keyword search, item popover and lock, character tabs, moves. Journey: `manager`.
- [Weapon search](./weapons.md): name search, filter chips, details pane, perk picks. Journey: `weapons`.
- [Armor table](./armor.md): name search, Searches (usage) column, Junk, Duplicates. Journey: `armor`.
- [Settings and sync](./settings.md): theme, site icon, clearing usage history, synced sidebar links. Journey: `settings`.

## Not yet mapped

These features have no recipe yet:
- Compare and the perk finder (Items → popover → "Compare N copies")
- Activity sets
- Import in-game loadout
- Share links (`#import=`)
- Report a bug
- Cleanup view on /armor
- Exotic and set-bonus pickers
- Phone layouts (below 768 px)

The stub already answers their API calls. Add a feature file and a journey when you touch one of them.
