# Saved loadouts

The Loadouts page has two tabs. Conflux lists the user's saved loadouts as cards: a user can search them, edit and rename one, equip it on a character (the apply card streams progress), save it into an in-game loadout slot, empty in-game slots, delete one after confirming, or delete them all. In-game (`/loadouts?view=in-game`) shows each character's in-game slots and is where activity sets are built.

## Sub-features

- `lo-search` makes the search box filter the cards and the count.
- `lo-edit` renames a loadout in the editor drawer and saves it.
- `lo-equip` makes Equip stream an apply and report it applied.
- `lo-ingame` makes Save in-game equip the loadout and then snapshot it into the chosen slot.
- `lo-ingame-delete` empties the in-game slots ticked in "Delete in-game loadouts".
- `lo-delete` deletes one loadout after a confirm dialog.
- `lo-bulk` makes "Delete all loadouts" empty the list.
- `lo-ingame-tab` shows the character's slots on the In-game tab and survives a reload (journey `loadouts-ingame.mjs`, as are the next two).
- `lo-set-build` creates an activity set on the page, assigns a slot, and saves it to `/api/settings/activitySets`.
- `lo-set-labels` picks an assigned slot's name, icon and color with `button "Customize slot N"`, saves them on the set, and applying the set snapshots the slot with them.
- `lo-set-from-slots` keeps a private copy of each filled slot as a new set with Save as set; the copies never reach the Conflux list and are deleted once no set uses them.
- `lo-ingame-customize` changes a filled slot's name, icon and color from the pencil beside its name, `button "Customize <name>"` (`PATCH /api/bungie/ingame-loadouts`), without equipping anything.
- `lo-dim-import` turns a pasted DIM link (`dim.gg/<id>` through `GET /api/dim-share/<id>`, or DIM's full `?loadout=` link) into a reviewed copy (journey `loadouts-dim.mjs`).
- `lo-share` makes Share copy a short `/loadouts#s=<code>` link that opens the import drawer (journey `loadouts-share.mjs`).

## How to get to it (user POV)

- Click the `Loadouts` link in the sidebar, or load `/loadouts`.
- Per card: `button "Equip"`, and the menu `button "Actions for <name>"` with the menuitems Optimize, Equip, Save in-game, Edit, Tag, Share, Duplicate, Copy item IDs, Open in DIM, Delete.
- Tabs: `tab "Conflux"` and `tab "In-game"`, top left.
- Conflux page level: `button "More loadout actions"` holds Import in-game loadout, Import DIM loadout, Select loadouts, then Delete in-game loadout on its own (not red, since it only opens a dialog; disabled while an activity set runs), then the destructive Delete all loadouts.

## Driving it with verify-d2

Preconditions:

- `full` fixture. The seed holds two Hunter loadouts, `Raid build` and `Dungeon build`, made from the Hunter's equipped armor IDs (see `meta.seed` in `journeys/loadouts.mjs`). Record IDs must be UUIDs.
- The seed fills in-game slots 2 (`Dungeon`) and 3 (`Crucible`) with the Hunter's armor; the other eight are empty. The stub returns the same slots for every character, its identifier lists aren't empty, and its DELETE empties the slot in `stub.store.ingameSlots`. That DELETE answers 400 unless `characterId` is one of the fixture's characters and `loadoutIndex` is 0–31.

- **List.** Run `app.open("/loadouts")`. `article "Raid build"` and `article "Dungeon build"` are shown, and the count text reads `2 Loadouts`.
- **Search (`lo-search`).** Fill `searchbox /^Search loadouts/` with `raid`. `article "Dungeon build"` goes away and the count reads `1 of 2 loadouts`. Clearing the box brings it back.
- **Edit (`lo-edit`).** Click `button "Actions for Raid build"`, then `menuitem "Edit"`. In `dialog "Edit loadout"`, fill `textbox "Loadout name"` with `Raid build v2` and click `button "Save changes"`. The toast `Loadout updated` appears, `article "Raid build v2"` is shown, and `api.json` has `PUT /api/loadouts/1111…` with the new name.
- **Equip (`lo-equip`).** Click `button "Equip"` within `article "Raid build v2"`. A `status` named `Raid build v2 applied` appears. `api.json` has `POST /api/bungie/apply-loadout` → 200 (ndjson) whose `items` carry the 5 armor IDs.
- **Save in-game (`lo-ingame`).** Dismiss the apply card. Click `Actions for Raid build v2`, then `menuitem "Save in-game"`. In `dialog "Save to in-game loadout"`, click `radio /^Slot 1\b/`, then `button /^Equip and (save|replace)$/`. The toast `Saved to in-game loadout 1` appears. `api.json` now has a second `apply-loadout` and then `POST /api/bungie/ingame-loadouts` with `loadoutIndex: 0`.
- **Delete in-game (`lo-ingame-delete`).** Click `button "More loadout actions"`, then `menuitem "Delete in-game loadout"`. `dialog "Delete in-game loadouts"` lists only filled slots as `checkbox "<name> Slot <n>"` (`Dungeon Slot 2`, `Crucible Slot 3`). Tick `Dungeon Slot 2` and click `button "Delete loadout"`. A second step locks the picks and shows `Delete 1 in-game loadout from your Hunter? This can't be undone.`; nothing is sent yet. Click `button "Delete 1 in-game loadout"`. The toast `Deleted Dungeon` appears, the dialog closes, and `api.json` has `DELETE /api/bungie/ingame-loadouts` with `loadoutIndex: 1`. Reopening lists only `Crucible Slot 3`.
- **Delete (`lo-delete`).** Click `Actions for Dungeon build`, then `menuitem "Delete"`. Confirm with `button "Delete"` within the dialog named `Delete loadout?`. The toast `Loadout deleted` appears, the card is gone, and `DELETE /api/loadouts/2222…` → 200.
- **Delete all (`lo-bulk`).** Click `button "More loadout actions"`, then `menuitem "Delete all loadouts"`. Confirm with `button "Delete all"` within the dialog whose name starts `Delete all`. The text `No saved loadouts yet` appears, and `DELETE /api/loadouts` has the body `{ids:[…]}` naming the listed loadouts, so an activity set's private copies survive.
- **Share (`lo-share`, `run loadouts-share`).** Grant clipboard access with `page.s("Browser.grantPermissions", …)` and turn on focus emulation, then click `Actions for Raid build`, then `menuitem "Share"`. The toast `Share link copied` appears, `api.json` has `POST /api/loadout-shares` → `{code}`, and the clipboard holds `<origin>/loadouts#s=Share00000` (the stub numbers codes `ShareNNNNN`). Loading that link from `about:blank` fetches `GET /api/loadout-shares/Share00000` and opens `dialog "Import shared loadout"` with the name prefilled; `button "Import"` saves a copy. `/loadouts#s=Nope000000.` (trailing punctuation is dropped) toasts `That share link doesn't exist` and drops the hash. With `stub.store.sharesDown = true` the POST and GET answer 503: Share copies the long `#import=` link instead, with the description `Short links aren't available right now, so this one is long`, and it still opens the drawer; opening `#s=Share00000` toasts `Couldn't open the share link…` and keeps the hash, and once `sharesDown` is false a reload opens the drawer.
- **In-game tab (`lo-ingame-tab`, `run loadouts-ingame`).** Click `tab "In-game"`. The URL gains `?view=in-game`. The left column is one container per entry (`In the game now`, then each set), and only the open one shows its grid. In a set, slots it doesn't use are empty bracket placeholders whatever the game holds there. The grid is a radiogroup: `radio "Slot 2, Dungeon"`, `radio "Slot 1, Empty"`. Slot names are hover tooltips on the tiles. Clicking one opens `article "Slot 2, Dungeon"` on the right (the Conflux card body) with `button`s Edit, Replace, Copy to Conflux, `Delete Dungeon from the game`.
- **Edit an in-game slot (`lo-ingame-edit`).** `button "Edit"` on a filled slot opens `dialog "Edit slot N"` with `Save to slot` (main), `Save to slot and Conflux`, `Save to Conflux only` and Cancel. With both, the Conflux save goes first and the slot only updates if it worked. `button "Copy to Conflux"` opens `dialog "Copy to Conflux"` with the slot's gear; `Save to Conflux` there creates the loadout.
- **Edit from a set's slot (`lo-set-slot-edit`).** On a slot holding a Conflux loadout, the drawer has `button "Save to slot"` (a private copy, stored when the set is saved), `button "Save to slot and Conflux"` (updates the loadout now; the slot points at it) and `button "Save to Conflux only"` (updates the loadout now; the slot keeps a private copy of what it held, stored when the set is saved). A private copy just has `Save changes`.
- **Peek (`lo-set-peek`).** `checkbox "Preview the slot in-game"` in the strip under the Copy card of a slot outside the set dims in the real emblems of filled slots the set leaves alone (`[data-slot-peek]`), and adds `section "This slot's current loadout"` to the card of a selected slot outside the set. A slot in the set never shows it.
- **Set card footer.** Under the open set's grid: the status line, then Discard and Save while unsaved, `button "Apply in-game"` once saved, Stop while running. Under `In the game now`'s grid: `button "Save as set"`; its row has `button "Reload from the game"`.
- **Build a set (`lo-set-build`).** Click `button "New activity set"`. `textbox "Set name"` is in the set's card on the left. `button "Save set"` on an unnamed set marks that field `aria-invalid` and saves nothing; once named it's disabled until a loadout is assigned. Each saved set's row has `button "Rename <name>"` (an inline field; Enter saves at once) and `button "Delete <name>"`. Click `radio /^Slot 1, Empty/`, then `button /^Assign a loadout from Conflux/`, then `option "Raid build"` in its popover. `button /^Copy what's in this slot/` sits beside it, disabled when the slot is empty in-game. Nothing is stored yet: `article "Raid build"` shows the loadout with Change, Edit and Remove from set. Leaving (another set or character, the Conflux tab, any sidebar link) asks `dialog "Discard unsaved changes?"`, and `Keep editing` pulses Save (`.d2-attention`). Reload or close gets the browser's warning; the back button isn't caught, but the draft survives it. `Save set` sends `PUT /api/settings/activitySets`, then the main action becomes `button "Apply in-game"`.
- **Set from current slots (`lo-set-from-slots`).** Click `button "In the game now"`, then `button "Save as set"`. No dialog: a new unsaved set opens holding every filled slot. Hover a tile for `button "Exclude slot N"` / `button "Include slot N"`. Fill `textbox "Set name"` and click `button "Save set"`. One `POST /api/loadouts` per filled slot with `setOnly: true`, named after the slot; the set opens. `Remove slot 2 from the set` then `Save changes`, and deleting the set, each `DELETE` the copies they orphan. The Conflux count doesn't change.
- **Proof.** `01-list`, `02-applied`, `03-ingame-dialog`, `04-ingame-delete-dialog`, `05-ingame-delete-confirm`, `06-empty`.

## Gotchas

- Load share links from `about:blank`. Going to `/loadouts#…` while already on `/loadouts` only changes the hash, and the previous drawer may still be closing.

- The client never refetches after a write; it renders the server's answer. If a stub answer is wrong, the screen is wrong too.
- After a `PUT`, the cached copy wins if its `updatedAt` is newer than the response's. The stub sets `updatedAt` to now.
- The menu has a `Delete` item and the confirm dialog has a `Delete` button. Scope the confirm click to the dialog.
- The apply card (`status`, bottom-left) can cover menus. Dismiss it before the next step.
- Equip is disabled while the armory is still the cached IndexedDB copy ("Refreshing your gear from Bungie…"), while an activity set runs, or when no character of the loadout's class exists.
- The Import, Delete and Save in-game dialogs and the In-game tab all load slots through `useInGameLoadouts` (no caching). A set's slot tiles are named `Slot 2, Dungeon: not assigned`.
- Slot emblems render as broken images: the stub's icon paths are fake.
- Save in-game needs the in-game slots response to include non-empty `identifiers.names/icons/colors`. Without them the dialog says "no in-game loadout slots unlocked yet".
- The list is virtualized, so cards far below the fold aren't in the DOM until you scroll.
