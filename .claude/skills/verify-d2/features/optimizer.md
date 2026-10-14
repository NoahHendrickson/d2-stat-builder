# Stat optimizer

The home route lets a user pick a class, set a target for each of the six armor stats, and see the armor combinations that reach those targets. They can open a build to see its pieces, ask Dream build what they'd need to farm for higher targets, and save a build as a loadout.

## Sub-features

- `opt-target` makes a stat target filter the listed builds.
- `opt-open` expands a build card to its pieces, stat breakdown, and masterwork notes.
- `opt-dream` makes Dream build answer, at the build's own stats and at raised targets.
- `opt-save` turns "Save as loadout" into a stored loadout that the Loadouts page lists.

## How to get to it (user POV)

- Click the `Stat optimizer` link in the sidebar (`navigation "Main"`), or load `/`.
- Pick a class with the tabs named `Hunter, Power 450` / `Titan, Power 450` / `Warlock, Power 450`.
- Below 1024 px the results move behind a bottom-bar button that opens `#builds-mobile-sheet` (not mapped yet).

## Driving it with verify-d2

Preconditions:

- `full` fixture; the Hunter tab is selected by default.
- No saved loadouts (the default stub store).

- **Results.** Run `app.open("/")`. Wait for `progressbar "Search progress"` to go away. The text after `heading "Builds"` reads `N / M` (for example `50 / 200+`), and build cards are listed as buttons named `<exotic> <total> Health n Melee n Grenade n Super n Class n Weapons n …`.
- **Target (`opt-target`).** Run `page.fill({ role: "spinbutton", name: "Health target value" }, "100")`, then `press("Enter")`. The spinbutton value reads `100`. Within a few seconds every card's name shows `Health ≥ 100`. Poll for that end state; a quiet moment can come before the 250 ms debounced re-search.
- **Open (`opt-open`).** Click card `nth: 0`. Its `aria-expanded` becomes `true`, and the card shows an ARMOR table and a MASTERWORK list.
- **Dream (`opt-dream`).** Click `button "Dream build"` `nth: 0`. In `dialog "Dream build"`, wait until `progressbar "Dream build search"` has `aria-busy="false"`. The status reads `No farming needed`. Click `button "Raise Health by 1"` ten times, wait for `spinbutton "Health target value"` to reach start+10 and for the search to go idle again. The status reads `N new pieces` or `Out of reach`, never `Search failed`. Close it with `button "Close dialog"`.
- **Save (`opt-save`).** Hover card `nth: 0`, then click `button "Save as loadout"` `nth: 0`. In `dialog "Save loadout"`, fill `textbox "Loadout name"` with `verify-d2 build` and click `button "Save"`. The drawer closes, and the toast `Loadout saved` appears. `api.json` has `POST /api/loadouts` → 201 with `loadout.name` and at least 5 `equipped` items. Then `app.nav("/loadouts")` shows `article "verify-d2 build"`.
- **Proof.** `01-results`, `02-health-100`, `03-dream` (the dialog), `04-save-drawer`, `05-loadouts-after-save`.

## Gotchas

- The results status is plain text after the heading, not a `status` role. Read it with `waitForText(/\d[\d,]* \/ [\d,]+\+?/)`.
- The stat slider's `role=slider` has no accessible name; the `aria-label "<Stat> target"` sits on its `group`. Drive the spinbutton instead.
- Card footer labels are collapsed until hover. "Save as loadout" is still in the accessibility tree; hover the card first so the click lands on a visible button.
- Button names follow CSS uppercase (`SAVE AS LOADOUT`, `SAVE`). String names match case-insensitively.
- Which card comes first can change while background refinement runs. Assert properties every card shares, not a particular card.
- Fixture armor has no mod sockets, so the save drawer shows each stat mod as "not slotted". The saved loadout's stats then leave out the +mods; that's a fixture limit, not a bug.
- `localStorage["stat-builder:selections"]` restores targets and the exotic on reload. Fresh profiles start at all-zero targets.
