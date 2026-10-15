# Items (manager)

The Items page is a DIM-style inventory: characters, postmaster, and the vault as item tiles. A user can search with keywords, open an item's popover to lock or move it, and move items between the vault and characters. Wide screens show one row per character (nameplate strip, then weapons and armor laid out as on the game's character screen, a faint class sigil behind) with the vault in its own scrolling pane beside them; narrow screens show one character at a time under tabs. The gear in the search bar switches to the legacy layout (what prod had before: characters side by side in columns, the vault aligned to their slots); a first visit opens that menu by itself with a short intro.

## Sub-features

- `mgr-layout` opens the layout intro on a first visit and switches between character rows and legacy columns (kept in `stat-builder:manager-view:v1`).
- `mgr-search` makes a keyword search narrow the items and show a count.
- `mgr-lock` makes the popover's Lock button toggle the lock and send it to Bungie.
- `mgr-move` moves a vault item to a character from the popover's move buttons (touch).

## How to get to it (user POV)

- Click the `Items` link in the sidebar, or load `/manager`.
- Search with `combobox "Search items"`. The `F` key focuses it.
- Open an item with a click, or Enter or Space on a tile (`[role=button][draggable]`). A double-click equips the item on the first character.
- Move an item by dragging it to a character or the vault (mouse). With touch, use the move buttons in the popover.

## Driving it with verify-d2

Preconditions:

- `full` fixture, 1600×1000. With the sidebar open the layout is about 1310 px: character rows (each slot's unequipped items in a 3×3 grid) with the vault beside them (`rowsLayout` in manager-view.tsx).

- **Open.** Run `app.open("/manager")`. `region /^Characters/` is shown, with one `button "<Class> options"` nameplate per character (3), and vault tiles (`{ css: '[aria-label="Vault"] [role=button][draggable]' }`) are mounted.
- **Layout (`mgr-layout`).** On a fresh profile the settings menu is already open: `menuitemradio /^Character rows/` is `aria-checked="true"`. Click `menuitemradio /^Legacy columns/`: the menu closes and `region "Characters and vault"` appears; at about 1310 px legacy shows one character at a time, so `tablist "Characters"` is there (all three columns need 1580 px). Click `button "Sort and group"`, then `button "Reset to defaults"`: the page stays on legacy (Reset only touches sort and grouping). Reopen `/manager`: the intro stays closed (seen flag `stat-builder:items-layout-intro-seen`). Click `button "Items settings"`, then `menuitemradio /^Character rows/`; the menu closes and `region "Characters"` is back.
- **Search (`mgr-search`).** Fill `combobox "Search items"` with `is:handcannon`. A `button /^\d+ items?$/` appears (50 on the full fixture), with fewer than the 456 weapons. Click `button "Clear search"` and the count button goes away.
- **Lock (`mgr-lock`).** Click vault tile `nth: 0` (named like `Monte Carlo, Auto Rifle, Power 442`). Click `button /^(Lock|Unlock)$/`. Its `aria-pressed` flips, the toast `Locked <item>` appears, and `POST /api/bungie/lock` carries `locked: true`.
- **Move (`mgr-move`).** Run `page.emulatePointer("coarse")`, which must return `true`. Click vault tile `nth: 1`, then the first `button /^(Pull|Send|Equip on)\b.*\b(Hunter|Titan|Warlock)$/` (for example `Equip on Hunter`). The toast `Equipped <item>` or `Moved <item>` appears, and `POST /api/bungie/move` has `from.kind: "vault"` and `to.kind: "character"`.
- **Proof.** `01-inventory`, `02-layout-intro`, `03-layout-legacy`, `04-search`, `05-locked`, `06-moved`.

## Gotchas

- The intro only opens over character rows: below about 1,180 px with the sidebar open (rows need 880 px of content) the page falls back to columns and holds it back.
- Character rows draw Ghost under the weapons on the left, and Sparrow and Ship on a sixth line, one each side (`[aria-label="Ghost"]` etc. are the unequipped drop zones).
- A fresh profile opens the layout intro menu over the top right of the page (not modal, so the page still scrolls); it closes on the first click outside it or a pick (and counts as seen). The `mgr-layout` step deals with it first.

- The move buttons render only for touch (`(pointer: coarse)`) or phone widths. CDP media-feature overrides don't flip `(pointer: coarse)`; Chrome touch emulation does (that's what `emulatePointer` uses).
- `[aria-label="Vault"]` is a `div` with no role at this width. Use CSS for vault tiles.
- The vault is virtualized: only lines within ±400 px of the viewport are mounted. Scroll the main scroller before you look for far tiles.
- Moves update the screen optimistically, then refetch the profile after 1.5 s. The stub's profile never changes, but the optimistic op stays applied until a profile reflects it, so the moved tile still shows in its new place.
- Mouse moves are native HTML5 drag-and-drop. `page.drag` dispatches mouse events, which don't start a native drag. Use the touch buttons or a double-click (equip) instead.
- Below 768 px the popover becomes a drawer named after the item, and the vault moves behind a `Vault` tab.
