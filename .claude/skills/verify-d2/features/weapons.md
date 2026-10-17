# Weapon search

The Weapon search page lists every weapon in the game. A user can search by name, narrow the list with filter chips picked from suggestions (trait, perk combo, barrel/mag, champion), and open a weapon to see its perk grid and stats and to try perks.

## Sub-features

- `wpn-search` makes a name search narrow the list to the weapon.
- `wpn-filter` turns a picked suggestion into a removable chip and a URL parameter, and narrows the list.
- `wpn-perks` opens a weapon's details pane, where picking a perk presses that perk.
- `wpn-mods` shows the weapon's stat-moving mods in `region "Mods"` under the perk grid; hovering one previews its stats, clicking one keeps it.
- `wpn-dps`: each boss DPS setup in Advanced stats shows the grid perks it ran; with more than one such setup they are a `radiogroup "DPS setups"`, and "See perks" at the bottom picks the chosen setup's perks in the grid.

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
- **Mods (`wpn-mods`).** Fill the combobox with `Fatebringer` and click the first `View Fatebringer perks`. In `region "Mods"`, hover `button "Ballistics"`: Range (the `dd` after `dt` "Range") rises (46 → 53). Click it: `aria-pressed="true"`, and Range stays raised after the pointer leaves.
- **DPS perks (`wpn-dps`).** Fill the combobox with `Synanceia` and open it. Click `button "Advanced stats"` (it starts closed), then `button "See perks"`: in `region "Perks"`, Jagged Edge, Relentless Strikes, Surrounded and Tenacity turn `aria-pressed="true"` (the top setup), and Elemental Honing (the second setup's) stays `false`.
- **DPS setup choice (`wpn-dps`).** Open `Hezen Vengeance` and Advanced stats. `radio /^13,514 boss DPS/` starts checked; See perks picks Cluster Bomb + Elemental Honing (once each: both trait columns roll them, so count picked tiles by `aria-label`). Click `radio /^8,226 boss DPS/` (no second See perks: once pressed, choosing a setup picks live): Envious Arsenal picked, Cluster Bomb let go, Elemental Honing kept. Clicking the top radio again brings Cluster Bomb back.
- **Proof.** `01-catalog`, `02-filtered`, `03-perk-picked` (the details pane), `04-mod-hover`, `05-mod-picked`, `06-dps-perks`, `07-dps-setup-picked`.

## Gotchas

- The count's word "weapons" is screen-reader-only, so `innerText` splits the count across lines. Read `page.name()` of the status.
- Search runs through `useDeferredValue`, and the status reads `Updating…` while it runs. Wait until it doesn't.
- Category suggestions drill in before they produce a chip. Pick until a `Remove …` chip exists.
- Observed on 2026-10-13: the suggestion read `Barrier 570`, but the filter listed 569 weapons. This is unexplained and may be a product bug; it is not covered by the journey.
- The list is virtualized (44 px rows), so only nearby rows exist in the DOM.
- Clarity (`database-clarity.github.io`) only feeds perk tooltip text. If it's down, tooltips fall back to Bungie's text.
- Mods are only the ones that move a stat the weapon shows; Adept mods appear only on (Adept)/(Timelost)/(Harrowed) weapons, and where a mod has an Enhanced version only that one is listed. Exotics mostly have none.
- "See perks" picks the chosen setup (the first that names a perk, at the start) and first clears every column any setup names, so switching setups leaves nothing behind; picks in other columns stay. A perk name fills one column only, the first that has it. It shows only when a setup names a perk in the weapon's grid; names match exactly once the sheet's `e. ` prefix, `xN` stacks and bracketed notes are stripped, so most exotics (whose setups name only buffs) go without it.
- Below 1024 px the details pane becomes a dialog titled with the weapon name.
