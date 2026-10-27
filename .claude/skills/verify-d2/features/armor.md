# Armor table

The Armor table lists every armor piece the user owns, with its stats, tuning and set. A user can search by name, filter from the toolbar or a column header, sort, mark pieces as junk, and switch to a view that lists only duplicates. Optimizer usage (the Searches column and the Cleanup view) is paused by `BUILD_USAGE_PAUSED` in `src/lib/build-usage/paused.ts`.

## Sub-features

- `arm-usage` checks that the Searches column and the Cleanup button stay hidden while usage is paused.
- `arm-search` makes a name search narrow the rows and the piece count.
- `arm-junk` makes the row's Junk toggle tag the piece as junk.
- `arm-sort` makes a column menu's "Then by" add a nested sort, and its "Remove from sort" drop one.
- `arm-col-filter` makes a column header's filter button edit the same filter as the toolbar, in both directions.
- `arm-dupes` makes the Duplicates view list only pieces that have a duplicate.

## How to get to it (user POV)

- Click the `Armor table` link in the sidebar, or load `/armor`.
- Toolbar: `searchbox "Search armor by name"` (the `F` key focuses it), `Class`/`Armor`/`Set` menus, `More filters`, and `button "Duplicates"` + `What duplicates must share`.
- Row actions are `Move`, `Equip` and `Junk`, shown when the row is hovered. Below `md` widths they move into a `<piece> actions` menu.
- Column headers: `button "Sort by <column>"`, and on Class, Archetype, Tertiary, Tuned and Set bonus a `button "Filter <label>: <all label>"` named like the toolbar menu (`Filter Class: All classes`, `Filter Class: Titan — 1 selected` while in effect). Both icons always show: dim at rest, full on hover.

## Driving it with verify-d2

Preconditions:

- `full` fixture (387 pieces).
- The `meta.profile` hook clones one vault armor piece as `dupe1`, so a duplicate pair exists.
- The `meta.seed` hook gives every armor piece `{ eligible: 30, used: 0 | 12 }` in the build-usage store.

- **Table.** Run `app.open("/armor")`. The text `387 pieces` is shown at the top of `main`.
- **Usage (`arm-usage`).** No `Sort by Searches` header and no `Cleanup` button. The usage seed stays for when the pause is lifted.
- **Search (`arm-search`).** Fill the searchbox with the first row's name. The count reads `1 piece`, and the first row is that piece. Clearing the box restores 387.
- **Junk (`arm-junk`).** Hover the first row's second cell, then click `button "Junk"` within the row. It becomes `aria-pressed="true"`, and `localStorage["stat-builder:item-annotations:v1:verify-user"]` contains `junk`. No request is sent.
- **Sort (`arm-sort`).** Click `button "Sort by Class"` (`nth: 0`), then `menuitem /A→Z/` (`nth: 0`, the "Sort by" group). Click `button "Sort by Health"`, then `menuitem /High→Low/` (`nth: 1`, the "Then by" group). The header reads `Sort by Health (2nd of 2)`, and rows run by class, then Health high → low. There is no toolbar Sort button. From `button "Sort by Class (1st of 2)"`, `menuitem "Remove from sort"` leaves `button "Sort by Health"` with no number.
- **Column filter (`arm-col-filter`).** `Filter Class: All classes` shows at rest and its icon reaches opacity 1 on hover; the sort button inside `button "Sort by Class"` (`nth: 0`) measures 24×24. Click it, then `menuitemcheckbox "Titan"`: the count drops, every row is Titan, and the toolbar reads `button /^Class: Titan/`. `Clear class filter` in the toolbar restores the count and the header button's name.
- **Duplicates (`arm-dupes`).** Click `button "Duplicates"`. It becomes `aria-pressed="true"`, fewer than 387 rows show, and two rows share a name (the clone and its original).
- **Proof.** `01-table`, `02-junk`, `03-sort-chain`, `04-column-hover`, `05-column-filtered`, `06-duplicates`.

## Gotchas

- Table rows have no accessible name in Chrome. Use `{ css: "table tbody tr" }`; the first cell's name is `<piece> Move Equip Junk`.
- The count is singular for one piece (`1 piece`).
- Junk is screen-reader-only until the row is hovered. Hover it first so the click lands on a visible button.
- The real fixture has no duplicates. Without the `meta.profile` clone, Duplicates shows only `No duplicates here: …`, which proves nothing about the duplicate rows.
- Usage only applies once the loadouts query has succeeded (the stub answers it). A rating needs at least 20 eligible searches; below that the bucket is "unknown".
- The stat named Class shares the name `Sort by Class` with the Class column; the column's header is `nth: 0`.
- Header filter buttons are always shown only when the table is at least 81.5rem wide (the `armor-narrow` variant in globals.css; the journey's 1600px window is). Narrower, they collapse to zero width until the column is hovered, the button has keyboard focus, the menu is open, or the filter is in effect. They stay in the tab order and the accessibility tree.
- Filters and sort persist to `localStorage["stat-builder:armor-table"]` after 300 ms.
