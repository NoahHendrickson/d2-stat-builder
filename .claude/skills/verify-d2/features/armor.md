# Armor table

The Armor table lists every armor piece the user owns, with its stats, tuning, set and optimizer usage. A user can search by name, mark pieces as junk, and switch to views that list only duplicates or only cleanup candidates.

## Sub-features

- `arm-usage` checks that the Searches column and the Cleanup button stay hidden while usage is paused.
- `arm-search` makes a name search narrow the rows and the piece count.
- `arm-junk` makes the row's Junk toggle tag the piece as junk.
- `arm-dupes` makes the Duplicates view list only pieces that have a duplicate.

## How to get to it (user POV)

- Click the `Armor table` link in the sidebar, or load `/armor`.
- Toolbar: `searchbox "Search armor by name"` (the `F` key focuses it), `Class`/`Armor`/`Set` menus, `More filters`, and `button "Duplicates"` + `What duplicates must share`.
- Row actions are `Move`, `Equip` and `Junk`, shown when the row is hovered. Below `md` widths they move into a `<piece> actions` menu.

## Driving it with verify-d2

Preconditions:

- `full` fixture (387 pieces).
- The `meta.profile` hook clones one vault armor piece as `dupe1`, so a duplicate pair exists.
- The `meta.seed` hook gives every armor piece `{ eligible: 30, used: 0 | 12 }` in the build-usage store.

- **Table.** Run `app.open("/armor")`. The text `387 pieces` is shown at the top of `main`.
- **Usage (`arm-usage`).** No `Sort by Searches` header and no `Cleanup` button. The usage seed stays for when the pause is lifted.
- **Search (`arm-search`).** Fill the searchbox with the first row's name. The count reads `1 piece`, and the first row is that piece. Clearing the box restores 387.
- **Junk (`arm-junk`).** Hover the first row's second cell, then click `button "Junk"` within the row. It becomes `aria-pressed="true"`, and `localStorage["stat-builder:item-annotations:v1:verify-user"]` contains `junk`. No request is sent.
- **Duplicates (`arm-dupes`).** Click `button "Duplicates"`. It becomes `aria-pressed="true"`, fewer than 387 rows show, and two rows share a name (the clone and its original).
- **Proof.** `01-table`, `02-junk`, `03-duplicates`.

## Gotchas

- Table rows have no accessible name in Chrome. Use `{ css: "table tbody tr" }`; the first cell's name is `<piece> Move Equip Junk`.
- The count is singular for one piece (`1 piece`).
- Junk is screen-reader-only until the row is hovered. Hover it first so the click lands on a visible button.
- The real fixture has no duplicates. Without the `meta.profile` clone, Duplicates shows only `No duplicates here: …`, which proves nothing about the duplicate rows.
- Usage only applies once the loadouts query has succeeded (the stub answers it). A rating needs at least 20 eligible searches; below that the bucket is "unknown".
- Filters and sort persist to `localStorage["stat-builder:armor-table"]` after 300 ms.
