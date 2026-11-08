# Farm list

Once a left and a right perk are picked on a weapon in Weapon search, an "Add to Farm list" button appears in the Perks header. Clicking it checks the vault first: an owned copy with everything picked gets "You already have this roll." in the Perks header, in place of the button. Craftable weapons get no button. Whenever the profile loads, a waiting entry whose two traits and other picks (all but the masterwork) show up on a copy is marked obtained. A toast says so, and the sidebar's `Farm list` link shows a count until the page is opened. `/farm-list` is two panels side by side, Armor and Weapons, with one card per entry listing only what was asked for (and, on a drop, what a free column rolled). Each panel has an All / Waiting / Obtained filter in its header, and each group sits under a strip that opens and closes it. Groups run Dropped (each wanted perk the copy has filled blue, a miss in a red ring with a light red fill and what it rolled under it, plus "Not this one" and "Done"), Waiting ("Open" and "Remove"), then Obtained (the record: Done keeps the entry there, with only "Remove").

## Sub-features

- `entry-drop`: a waiting entry with a matching copy turns obtained on load. Shows a toast, a PATCH `{ obtained }`, and the link `Farm list (1 new)`.
- `entry-add`: picking both traits shows `Add to Farm list`. Adding POSTs the entry, and the button becomes `On your Farm list`.
- `entry-owned`: an owned roll says so in the Perks header, and can't be added.
- `entry-strict`: everything picked but the masterwork has to be on the copy. A copy with both perks and a different picked barrel or magazine isn't "owned" and doesn't count as the drop, and that pick is a separate entry.
- A new drop whose copy is gone and was never kept with Done is deleted by the watcher, only on a whole profile minted after the drop (`dismantledDrops`). A kept record stays, its required perks shown blue.
- `entry-craftable`: craftable weapons never show the button.
- `entry-page`: one table row per entry, with Obtained above Waiting and every perk column compared. Opening the page PATCHes `{ seen: true }`, and `Not this one` PATCHes `{ reject: true }` and moves the entry to Waiting.

## How to get to it (user POV)

- The `button "Add to Farm list"` in `region "Perks"` of `complementary "Weapon details"` on `/weapons`.
- The sidebar `link "Farm list"` (`"Farm list (N new)"` while drops are unseen), or load `/farm-list`.

## Driving it with verify-d2

Preconditions:

- The `full` fixture, reshaped by the journey's `meta.profile`: two Synanceia copies in the vault with numeric instance ids (`6917529000000000001`: Relentless Strikes + Surrounded; `…0002`: Attrition Orbs + Burning Ambition). It also seeds one waiting entry for Relentless Strikes + Surrounded, with extras Hungry Edge (the copy has it) and an Impact masterwork (it doesn't, which doesn't stop a match), plus a second waiting entry asking for Burst Guard that must keep waiting.

- **Drop (`entry-drop`).** Run `page.goto("/weapons")`, then `app.toast(/Farm list: Synanceia dropped/)` right away. The toast lasts 5 s, and `app.open` waits for the catalog, which can take longer. `api.json` has `PATCH /api/farm-list/1111…` with `obtained: …0001`.
- **Add (`entry-add`).** Search `Synanceia` and open it. Picking Relentless Strikes and Surrounded offers `Add to Farm list`; adding Hungry Edge shows `On your Farm list` (the seeded entry, which asks for that blade). Unpick Hungry Edge and Relentless Strikes, pick Proximity Power, and click `Add to Farm list`. A POST with both traits and no ignored ids is sent.
- **Owned (`entry-owned`).** Pick Attrition Orbs and Burning Ambition, then click `Add to Farm list`. The text "You already have this roll." replaces the button, and no add button remains.
- **Craftable (`entry-craftable`).** Open Fatebringer and pick Explosive Payload and Adrenaline Junkie. No button matching `/Farm list/i` appears.
- **Page (`entry-page`).** Click `link "Farm list (1 new)"`. In the Weapons `[data-group="dropped"]`, `[data-column="barrel|left|right"]` hold `image "Matches"`. `magazine` holds only the text "Balanced Guard" (what the copy rolled). `masterwork` doesn't match ("None"), and there is no `origin` field. `[data-group="waiting"]` has 3 `[data-entry]`. `Not this one` removes the Dropped group, Waiting goes to 4, and the stub's entry now ignores `…0001`.
- **Proof.** `01-drop-toast`, `02-added`, `03-owned`, `04-page`, `05-rejected`.

## Gotchas

- The Farm list only counts numeric instance ids (real Bungie ids). The fixture's `instN` copies never match, so a journey has to add its own copies.
- Groups, cards and fields have no useful accessible names, so find them by css inside `section[aria-label="Armor"|"Weapons"]`: `[data-group]`, `[data-entry]`, `[data-column]`. The barrel mark waits on the manifest (it reads the copy's roll), so wait for it before asserting.
- `app.nav("/farm-list")` looks for the plain name `Farm list`. While a drop is unseen, the link is named `Farm list (1 new)`.
- The fixture profile never changes, so a rejected copy stays in the vault. It must not match again (it's in `ignoredInstanceIds`).
- The client and the stub are proven here, but Neon is not. The real store's SQL (first match sticks, reject appends to ignored) was checked only as literal SELECTs.

## Armor

Only a piece of a required set can be added: pick a set bonus first. Theoretical Builds rows for a required set's pieces have a star button (`Add <title> to your Farm list`), and a Dream build's Replace card for such a piece has `Add to Farm list`. Other rows, and exotics, have neither. An entry stores the class, slot, archetype, set, and the tertiary and tuned combinations that work. A match has to be a Tier 5 legendary with all of those. One copy fills one entry. `/farm-list` shows Armor beside Weapons. An armor card's art is the drop, else the set's piece for that slot (read from the manifest).

- `armor-theory`, `armor-dream`, `armor-page`: journey `farm-list`. The fixture's armor has no sockets or archetypes, so `meta.profile` gives the Hunter's armor numeric ids and a Brawler plug (`3349393475`), and a seeded any-tertiary TM Custom Brawler helmet entry drops on load (`Farm list (2 new)`).
- If a build row's piece is already owned, its button only shows a "You already have this roll" toast and posts nothing, so `addArmor` in the journey would time out.
- Dream needs a trade-off here: raising one stat alone goes from "No farming needed" to "Out of reach". Lower Melee, then raise Health.
