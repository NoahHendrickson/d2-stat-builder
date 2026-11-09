# Stat optimizer

The home route lets a user pick a class, set a target for each of the six armor stats, and see the armor combinations that reach those targets. They can open a build to see its pieces, ask Dream build what they'd need to farm for higher targets, and save a build as a loadout.

## Sub-features

- `opt-target` makes a stat target filter the listed builds.
- `opt-open` expands a build card to its pieces, stat breakdown, and masterwork notes.
- `opt-dream` makes Dream build answer, at the build's own stats and at raised targets.
- `opt-save` turns "Save as loadout" into a stored loadout that the Loadouts page lists.
- `opt-update` makes Optimize on a saved loadout turn each card's save into "Update loadout", which replaces that loadout's armor and keeps its name, notes, weapons and subclass (`journeys/optimizer-update.mjs`).
- `opt-overmax` explains an empty list when one target is past its max: the frame around that row's bar turns red, the list names the stat and its max, and `Set <Stat> to <max>` brings builds back, on desktop and in the phone's builds sheet.
- `opt-raid` lists the legacy (Armor 2.0) raids the class owns armor from under Set bonuses, and requiring N pieces of one puts that many in every build (`journeys/optimizer-raids.mjs`).

## How to get to it (user POV)

- Click the `Stat optimizer` link in the sidebar (`navigation "Main"`), or load `/`.
- Pick a class with the tabs named `Hunter, Power 450` / `Titan, Power 450` / `Warlock, Power 450`.
- Below 1024 px the results move behind a bottom-bar button that opens `#builds-mobile-sheet` (not mapped yet).

## Driving it with verify-d2

Preconditions:

- `full` fixture; the Hunter tab is selected by default.
- No saved loadouts (the default stub store).

- **Results.** Run `app.open("/")`. Wait for `progressbar "Search progress"` to go away. The text after `heading "Builds"` reads `N / M` (for example `50 / 200+`), and build cards are listed as buttons named `<exotic> <total> Health n Melee n Grenade n Super n Class n Weapons n …`.
- **Target (`opt-target`).** Run `page.fill({ role: "spinbutton", name: "Health target value" }, "100")`, then `press("Enter")`. The spinbutton value reads `100`. Within a few seconds every card's name shows `Health ≥ 100`. Poll for that end state. Typing and slider drags search 250 ms after the last change; Enter, blur, a slider release and every click (ticks, toggles, picks, Reset) search at once.
- **Open (`opt-open`).** Click card `nth: 0`. Its `aria-expanded` becomes `true`, and the card shows an ARMOR table and a MASTERWORK list.
- **Dream (`opt-dream`).** Click `button "Dream build"` `nth: 0`. In `dialog "Dream build"`, wait until `progressbar "Dream build search"` has `aria-busy="false"`. The status reads `No farming needed`. Click `button "Raise Health by 1"` ten times, wait for `spinbutton "Health target value"` to reach start+10 and for the search to go idle again. The status reads `N new pieces` or `Out of reach`, never `Search failed`. Close it with `button "Close dialog"`.
- **Save (`opt-save`).** Hover card `nth: 0`, then click `button "Save as loadout"` `nth: 0`. In `dialog "Save loadout"`, fill `textbox "Loadout name"` with `verify-d2 build` and click `button "Save"`. The drawer closes, and the toast `Loadout saved` appears. `api.json` has `POST /api/loadouts` → 201 with `loadout.name` and at least 5 `equipped` items. Then `app.nav("/loadouts")` shows `article "verify-d2 build"`.
- **Update (`opt-update`, its own journey).** The seed is one Hunter loadout `Raid build` (equipped armor, the kinetic weapon, a Gunslinger carrier, notes, a Health 100 constraint). On `/loadouts`, click `Actions for Raid build`, then `menuitem "Optimize"`. Above the build list, `note "Linked loadout: Raid build"` (Super icon first) names `Raid build` and has a `button "Unlink"`, and every card's emphatic button is `Update loadout` (none says Save as loadout). Clicking it opens `dialog "Update loadout"` with the name and notes prefilled and a `button "Save as new"`. Its `button "Update loadout"` sends `PUT /api/loadouts/1111…` (no POST) whose `loadout` keeps the weapon and subclass and whose armor is `optimizer.pieceIds`; the toast is `Loadout updated`, and `/loadouts` still counts 1. Unlink removes the strip and brings back Save as loadout. Re-optimizing and choosing Save as new in that drawer POSTs a new loadout with its own DIM id (not the linked one's) and the form's weapon. Clicking another class tab (`tab /^Warlock, Power/`) or Reset on Stats ends the link.
- **Over max (`opt-overmax`).** From `/`, fill and Enter Health 100, Melee 60, Grenade 90, Super 200. The header reads `No builds match` and the list reads `Super can reach 122 with your other targets.` ("at least 122" while that max is unproven; with several culprits: `Health can reach 170 or Class 125 with your other targets. Lowering any one is enough.`, one button each). The Super row is the only `[data-over-max]` element; its `[data-slot=slider-track]` has `data-invalid` and the frame around the bar (the track's `::before`) is the destructive colour, with a ring that pulses out twice as it appears. The row itself has no outline, and `spinbutton "Super target value"` has `aria-invalid="true"`. The other five rows read their own target as the max (`100 / 100`, `0 / 0`). `button "Set Super to 122"` sets the target and the builds come back with Super ≥ 122 on every card. On a phone (390 px), open the bar `[aria-controls="builds-mobile-sheet"]`; the same button sits inside `#builds-mobile-sheet` and the builds land in the open sheet. The sheet hides the page from the accessibility tree: press Escape before reading a spinbutton.
- **Raids (`opt-raid`, its own journey).** The fixture has no Armor 2.0 raid armor, so `optimizer-raids.mjs` adds Hunter pieces with `meta.profile`: Deep Stone Crypt in all five slots, Vow of the Disciple and Last Wish in arms + legs. Click `button "Legacy raid sets (3)"` (name starts `Legacy raid sets`; a requirement adds `N required`). Each raid has `list "<raid> pieces owned"` with `listitem "<Slot>: <piece name>"` or `"<Slot>: not owned"`, and `tablist "<raid> pieces every build must wear"` with tabs `Not required`, `At least 1` … `At least 5`. A count that can't be worn beside the other picks has `data-disabled`. Requiring `At least 3` of Deep Stone Crypt puts a `3pc` pill titled `Deep Stone Crypt raid armor` on every card. Vow 2 disables every Last Wish count (they share arms + legs). The Save as loadout request carries `builder.raidReqs`. Theoretical Builds hides the block.
- **Proof.** `01-results`, `02-health-100`, `03-dream` (the dialog), `04-save-drawer`, `05-loadouts-after-save`, `06-over-max`, `07-over-max-fixed`, `08-over-max-phone`, `09-over-max-phone-fixed`.

## Gotchas

- The results status is plain text after the heading, not a `status` role. Read it with `waitForText(/\d[\d,]* \/ [\d,]+\+?/)`.
- The stat slider's `role=slider` has no accessible name; the `aria-label "<Stat> target"` sits on its `group`. Drive the spinbutton instead.
- Card footer labels are collapsed until hover. "Save as loadout" is still in the accessibility tree; hover the card first so the click lands on a visible button.
- Button names follow CSS uppercase (`SAVE AS LOADOUT`, `SAVE`). String names match case-insensitively.
- Which card comes first can change while background refinement runs. Assert properties every card shares, not a particular card.
- Fixture armor has no mod sockets, so the save drawer shows each stat mod as "not slotted". The saved loadout's stats then leave out the +mods; that's a fixture limit, not a bug.
- `localStorage["stat-builder:selections"]` restores targets and the exotic on reload. Fresh profiles start at all-zero targets.
- Card names come from the stat icons' alt text, so a card's `textContent` has no "Health". To read its pills from the DOM, find the cards as `button[aria-expanded]` containing `[alt=Health]`.
- After a raid pick the search starts at once, but its progress bar can come and go between two polls on the small fixture. Poll for every card's pill instead of waiting on the progress bar alone.
- The build list appears as soon as the walk ends; the slider maximums can still be proving for up to about 1.2 s after it (the inline text and the Max tick read `N+` meanwhile). Wait for the end state you assert on, not for the list alone.
- The max rows read `/ N+` (inline) and `N+` (tick) whenever a max is unproven, not only `/ N`.
