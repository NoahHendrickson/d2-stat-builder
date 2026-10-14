# Items (manager)

The Items page is a DIM-style inventory: characters, postmaster, and the vault as item tiles. A user can search with keywords, open an item's popover to lock or move it, switch characters, and move items between the vault and characters.

## Sub-features

- `mgr-search` makes a keyword search narrow the items and show a count.
- `mgr-lock` makes the popover's Lock button toggle the lock and send it to Bungie.
- `mgr-tabs` makes the character tabs switch which character column is shown (compact layout).
- `mgr-move` moves a vault item to a character from the popover's move buttons (touch).

## How to get to it (user POV)

- Click the `Items` link in the sidebar, or load `/manager`.
- Search with `combobox "Search items"`. The `F` key focuses it.
- Open an item with a click, or Enter or Space on a tile (`[role=button][draggable]`). A double-click equips the item on the first character.
- Move an item by dragging it to a character or the vault (mouse). With touch, use the move buttons in the popover.

## Driving it with verify-d2

Preconditions:

- `full` fixture, 1600×1000. With the sidebar open, the layout is narrower than 1580 px, so it's compact: `tablist "Characters"` has Hunter, Titan, Warlock.

- **Open.** Run `app.open("/manager")`. `region /^Characters/` is shown, the tablist has 3 tabs, and vault tiles (`{ css: '[aria-label="Vault"] [role=button][draggable]' }`) are mounted.
- **Search (`mgr-search`).** Fill `combobox "Search items"` with `is:handcannon`. A `button /^\d+ items?$/` appears (50 on the full fixture), with fewer than the 456 weapons. Click `button "Clear search"` and the count button goes away.
- **Lock (`mgr-lock`).** Click vault tile `nth: 0` (named like `Monte Carlo, Auto Rifle, Power 442`). Click `button /^(Lock|Unlock)$/`. Its `aria-pressed` flips, the toast `Locked <item>` appears, and `POST /api/bungie/lock` carries `locked: true`.
- **Tabs (`mgr-tabs`).** Click `tab "Titan"`. `button "Titan options"` appears and the tab has `aria-selected="true"`.
- **Move (`mgr-move`).** Run `page.emulatePointer("coarse")`, which must return `true`. Click vault tile `nth: 1`, then the first `button /^(Pull|Send|Equip on)\b.*\b(Hunter|Titan|Warlock)$/` (for example `Equip on Hunter`). The toast `Equipped <item>` or `Moved <item>` appears, and `POST /api/bungie/move` has `from.kind: "vault"` and `to.kind: "character"`.
- **Proof.** `01-inventory`, `02-search`, `03-locked`, `04-moved`.

## Gotchas

- The move buttons render only for touch (`(pointer: coarse)`) or phone widths. CDP media-feature overrides don't flip `(pointer: coarse)`; Chrome touch emulation does (that's what `emulatePointer` uses).
- `[aria-label="Vault"]` is a `div` with no role at this width. Use CSS for vault tiles.
- The vault is virtualized: only lines within ±400 px of the viewport are mounted. Scroll the main scroller before you look for far tiles.
- Moves update the screen optimistically, then refetch the profile after 1.5 s. The stub's profile never changes, but the optimistic op stays applied until a profile reflects it, so the moved tile still shows in its new place.
- Mouse moves are native HTML5 drag-and-drop. `page.drag` dispatches mouse events, which don't start a native drag. Use the touch buttons or a double-click (equip) instead.
- Below 768 px the popover becomes a drawer named after the item, and the vault moves behind a `Vault` tab.
