# Items (manager)

The Items page is a DIM-style inventory: characters, postmaster, and the vault as item tiles. A user can search with keywords, open an item's popover to lock or move it, and move items between the vault and characters. Wide screens show one row per character (nameplate strip, then weapons and armor laid out as on the game's character screen, a faint class sigil behind) with the vault in its own scrolling pane beside them; narrow screens show one character at a time under tabs. The gear in the search bar switches between that and the legacy layout (characters side by side in columns, the vault aligned to their slots). A new browser starts on legacy columns; one that used the app before 2026-11-04 without saving a layout keeps character rows (`stat-builder:first-seen`, stamped by the app shell).

## Sub-features

- `mgr-layout`: a fresh profile starts on legacy columns; the gear switches to character rows, which survives a reload (kept in `stat-builder:manager-view:v1`).
- `mgr-sort` reorders the sort by dragging a key's box (or its grip's arrow keys) and offers only the groupings that fit weapons or armor.
- `mgr-search` makes a keyword search narrow the items and show a count.
- `mgr-lock` makes the popover's Lock button toggle the lock and send it to Bungie.
- `mgr-move` moves a vault item to a character from the popover's move buttons (touch).
- `mgr-ornaments` turns on Show ornaments, so every ornamented tile wears its ornament's art (journey `manager-ornaments`).

## How to get to it (user POV)

- Click the `Items` link in the sidebar, or load `/manager`.
- Search with `combobox "Search items"`. The `F` key focuses it.
- Open an item with a click, or Enter or Space on a tile (`[role=button][draggable]`). A double-click equips the item on the first character.
- Move an item by dragging it to a character or the vault (mouse). With touch, use the move buttons in the popover.

## Driving it with verify-d2

Preconditions:

- `full` fixture, 1600×1000. With the sidebar open the layout is about 1310 px: character rows (each slot's unequipped items in a 3×3 grid) with the vault beside them (`rowsLayout` in manager-view.tsx).

- **Open.** Run `app.open("/manager")`. A fresh profile starts on legacy columns: `region "Characters and vault"`, no menu open, and at about 1310 px one character at a time under `tablist "Characters"` (all three columns need 1634 px). Click `button "Items settings"`: `menuitemradio /^Legacy columns/` is `aria-checked="true"`. Click `menuitemradio /^Character rows/`: the menu closes and `region "Characters"` is shown, with one `button "<Class> options"` nameplate per character (3), and vault tiles (`{ css: '[aria-label="Vault"] [role=button][draggable]' }`) are mounted.
- **Layout (`mgr-layout`).** Reopen `/manager`: still `region "Characters"` (the pick is saved). Click `button "Sort and group"`, then `button "Reset to defaults"`: the layout stays (Reset only touches sort and grouping). Switch to legacy columns and back through `button "Items settings"`. Under legacy, each nameplate has a `group "Champions and set bonuses"` (a `list "Champions your weapons stun"`, then set-bonus chips; the fixture stuns nothing and has no sets, so the tiles are faded and there are no chips). The `button /^Characters shown/` menu beside the vault tabs (`menuitemradio`s) (Current character / All characters; only with Legacy columns and room for all three), on Current character, shows only the last-played column, no tabs, its nameplate level with the vault's; with it on, the vault's Weapons or Armor tab trims the column to just those slots. On the Armor tab with every column showing, the vault's armor runs from the Kinetic row down instead of level with the armor slots (`characterColumns` in `stat-builder:manager-view:v1`). Click `button "Items settings"`, then `menuitemradio /^Character rows/`; the menu closes and `region "Characters"` is back.
- **Sort (`mgr-sort`).** Click `button "Sort and group"`. Each sort key in use is an outlined `li` holding a `button /^Reorder <Key>/` grip (`data-sort-grip="<key>"`) and `button "Stop sorting by <Key>"`; the default order is rarity, power, name. Drag needs raw `Input.dispatchMouseEvent` through `page.s` (press, several moves, release): the `ol` captures the pointer and rows reorder live, saving on release. `button "Add"` opens a menu of the unused keys (`menuitem`). `radiogroup "Group vault weapons by"` / `"Group vault armor by"` hold `radio`s (`aria-checked`): armor is None, Class, Rarity, Gear tier. `button "Reset to defaults"` restores the order.
- **Search (`mgr-search`).** Fill `combobox "Search items"` with `is:handcannon`. A `button /^\d+ items?$/` appears (50 on the full fixture), with fewer than the 456 weapons. Click `button "Clear search"` and the count button goes away.
- **Lock (`mgr-lock`).** Click vault tile `nth: 0` (named like `Monte Carlo, Auto Rifle, Power 442`). Click `button /^(Lock|Unlock)$/`. Its `aria-pressed` flips, the toast `Locked <item>` appears, and `POST /api/bungie/lock` carries `locked: true`.
- **Move (`mgr-move`).** Run `page.emulatePointer("coarse")`, which must return `true`. Click vault tile `nth: 1`, then the first `button /^(Pull|Send|Equip on)\b.*\b(Hunter|Titan|Warlock)$/` (for example `Equip on Hunter`). The toast `Equipped <item>` or `Moved <item>` appears, and `POST /api/bungie/move` has `from.kind: "vault"` and `to.kind: "character"`.
- **Ornaments (`mgr-ornaments`, journey `manager-ornaments`).** The fixture has no ornaments, so `meta.profile` sets every vault item's `overrideStyleItemHash` to an equipped helmet's hash: its icon stands in for the ornament. Click `button "Items settings"`: `menuitemcheckbox /^Show ornaments/` is `aria-checked="false"`, and only the exotic weapons (first in each row by the default rarity sort) wear the helmet art. Click it: the menu stays open, every vault tile wears the helmet art, and `showOrnaments: true` is saved in `stat-builder:manager-view:v1` (it survives a reload). Proof: `01-menu-off`, `02-menu-on`, `03-vault-ornaments-on`.
- **Proof.** `01-layout-legacy`, `02-inventory`, `03-sort-dragging`, `04-sort-menu`, `05-search`, `06-locked`, `07-moved`.

## Gotchas

- Character rows need about 1,180 px with the sidebar open (880 px of content); below that the page falls back to columns.
- Character rows draw Ghost under the weapons on the left, and Sparrow and Ship on a sixth line, one each side (`[aria-label="Ghost"]` etc. are the unequipped drop zones).

- The move buttons render only for touch (`(pointer: coarse)`) or phone widths. CDP media-feature overrides don't flip `(pointer: coarse)`; Chrome touch emulation does (that's what `emulatePointer` uses).
- `[aria-label="Vault"]` is a `div` with no role at this width. Use CSS for vault tiles.
- The vault is virtualized: only lines within ±400 px of the viewport are mounted. Scroll the main scroller before you look for far tiles.
- Moves update the screen optimistically, then refetch the profile after 1.5 s. The stub's profile never changes, but the optimistic op stays applied until a profile reflects it, so the moved tile still shows in its new place.
- Mouse moves are native HTML5 drag-and-drop. `page.drag` dispatches mouse events, which don't start a native drag. Use the touch buttons or a double-click (equip) instead.
- Below 768 px the popover becomes a drawer named after the item, and the vault moves behind a `Vault` tab.
