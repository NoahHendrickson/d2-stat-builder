# Saved loadouts

The Loadouts page lists the user's saved loadouts as cards. A user can search them, edit and rename one, equip it on a character (the apply card streams progress), save it into an in-game loadout slot, empty in-game slots, delete one after confirming, or delete them all.

## Sub-features

- `lo-search` makes the search box filter the cards and the count.
- `lo-edit` renames a loadout in the editor drawer and saves it.
- `lo-equip` makes Equip stream an apply and report it applied.
- `lo-ingame` makes Save in-game equip the loadout and then snapshot it into the chosen slot.
- `lo-ingame-delete` empties the in-game slots ticked in "Delete in-game loadouts".
- `lo-delete` deletes one loadout after a confirm dialog.
- `lo-bulk` makes "Delete all loadouts" empty the list.

## How to get to it (user POV)

- Click the `Loadouts` link in the sidebar, or load `/loadouts`.
- Per card: `button "Equip"`, and the menu `button "Actions for <name>"` with the menuitems Optimize, Equip, Save in-game, Edit, Tag, Share, Duplicate, Copy item IDs, Open in DIM, Delete.
- Page level: `button "More loadout actions"` holds New activity set, Import in-game loadout, Select loadouts, then Delete in-game loadout on its own (not red, since it only opens a dialog; disabled while an activity set runs), then the destructive Delete all loadouts.

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
- **Delete all (`lo-bulk`).** Click `button "More loadout actions"`, then `menuitem "Delete all loadouts"`. Confirm with `button "Delete all"` within the dialog whose name starts `Delete all`. The text `No saved loadouts yet` appears, and `DELETE /api/loadouts` has the body `{all:true}`.
- **Proof.** `01-list`, `02-applied`, `03-ingame-dialog`, `04-ingame-delete-dialog`, `05-ingame-delete-confirm`, `06-empty`.

## Gotchas

- The client never refetches after a write; it renders the server's answer. If a stub answer is wrong, the screen is wrong too.
- After a `PUT`, the cached copy wins if its `updatedAt` is newer than the response's. The stub sets `updatedAt` to now.
- The menu has a `Delete` item and the confirm dialog has a `Delete` button. Scope the confirm click to the dialog.
- The apply card (`status`, bottom-left) can cover menus. Dismiss it before the next step.
- Equip is disabled while the armory is still the cached IndexedDB copy ("Refreshing your gear from Bungie…"), while an activity set runs, or when no character of the loadout's class exists.
- The Import, Delete and Save in-game dialogs and the activity set editor all load slots through `useInGameLoadouts` (no caching). The activity set editor names its tiles `2 DUNGEON`, not `Slot 2`.
- Slot emblems render as broken images: the stub's icon paths are fake.
- Save in-game needs the in-game slots response to include non-empty `identifiers.names/icons/colors`. Without them the dialog says "no in-game loadout slots unlocked yet".
- The list is virtualized, so cards far below the fold aren't in the DOM until you scroll.
