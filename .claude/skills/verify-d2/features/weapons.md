# Weapon search

The Weapon search page lists every weapon in the game. A user can search by name, narrow the list with filter chips picked from suggestions (trait, perk combo, barrel/mag, champion), and open a weapon to see its perk grid and stats and to try perks.

## Sub-features

- `wpn-search` makes a name search narrow the list to the weapon.
- `wpn-filter` turns a picked suggestion into a removable chip and a URL parameter, and narrows the list.
- `wpn-perks` opens a weapon's details pane, where picking a perk presses that perk.

## How to get to it (user POV)

- Click the `Weapon search` link in the sidebar, or load `/weapons`. You can also load a URL that already has filters (`?q=&trait=&perkCombo=&gear=&champion=&sort=`).
- Use `combobox "Search weapons"`. Suggestions appear in `listbox "Filter suggestions"` once text is typed.
- Open a weapon with the `button "View <name> perks"` in each `listitem` of `list "Weapons"`. The top weapon is open by default.

## Driving it with verify-d2

Preconditions:

- Any fixture (the page reads the static `/data/weapons.json` and Clarity, not the profile). The page is still gated on the signed-in session.

- **Catalog.** Run `app.open("/weapons")`. The `status` name reads `N weapons Catalog updated <date>`, with N in the thousands.
- **Search (`wpn-search`).** Take a name from the 4th list button (for example `Conspiracy Honed`) and fill the combobox with it. The count drops (to 1), and `button "View <name> perks"` is listed. Press `Escape`, then click `button "Clear search and filters"`, and the count returns to N.
- **Filter (`wpn-filter`).** Click the combobox and type `anti-champion`. Click the first `option` in the listbox: `Champion 3` drills into the category. Click the first option again (`Barrier 570`). A `button "Remove Champion: Barrier"` chip appears, the count drops below N, and `location.search` contains `champion=`. Clicking the chip restores N.
- **Perks (`wpn-perks`).** Click `View <name> perks`. In `complementary "Weapon details"`, a `heading "<name>"` is shown. Click the first button with `aria-pressed="false"`, and it becomes `aria-pressed="true"`.
- **Proof.** `01-catalog`, `02-filtered`, `03-perk-picked` (the details pane).

## Gotchas

- The count's word "weapons" is screen-reader-only, so `innerText` splits the count across lines. Read `page.name()` of the status.
- Search runs through `useDeferredValue`, and the status reads `Updating…` while it runs. Wait until it doesn't.
- Category suggestions drill in before they produce a chip. Pick until a `Remove …` chip exists.
- Observed on 2026-10-13: the suggestion read `Barrier 570`, but the filter listed 569 weapons. This is unexplained and may be a product bug; it is not covered by the journey.
- The list is virtualized (44 px rows), so only nearby rows exist in the DOM.
- Clarity (`database-clarity.github.io`) only feeds perk tooltip text. If it's down, tooltips fall back to Bungie's text.
- Below 1024 px the details pane becomes a dialog titled with the weapon name.
