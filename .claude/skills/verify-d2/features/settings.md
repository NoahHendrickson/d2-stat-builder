# Settings and sync

The Settings page sets the app theme, the site icon and the armor usage history, all per device. Sidebar links, pinned sets and activity sets sync to the account: they are pushed to `/api/settings/<key>` and pulled back on load and on focus.

## Sub-features

- `set-theme` makes the Theme radios switch `<html data-app-theme>` and survive a reload.
- `set-icon` makes a Site icon radio swap the favicon.
- `set-usage` checks that the usage history section stays hidden while usage is paused (`BUILD_USAGE_PAUSED`).
- `set-sync` makes adding a sidebar link push it to `/api/settings/links`.

## How to get to it (user POV)

- Load `/settings`, or click the `link "Settings"` (the gear) next to the account menu at the bottom of the sidebar.
- Appearance: `tablist "Appearance"` (Light/Dark/System), `radiogroup "Theme"` (Scene/Slate/Normal), `radiogroup "Site icon"` (`Icon 1`…`Icon 9`). The usage section (`switch "Record searches on this device"`, `button "Clear history"`) is hidden while usage is paused.
- Sidebar links: `button "Add a link"` in `region "Links"`.

## Driving it with verify-d2

Preconditions:

- `small` fixture. The stub's settings store starts empty.

- **Open.** Run `app.open("/settings")`. The theme on load is `slate` (the server default).
- **Theme (`set-theme`).** Within `radiogroup "Theme"`, click `radio "Normal"` → `data-app-theme="normal"`, `radio "Scene"` → the attribute is removed, and `radio "Slate"` → `slate`. Each radio is `aria-checked="true"` after its click. Pick Normal and run `app.open("/settings")` again: it's still `normal`.
- **Icon (`set-icon`).** Click `radio "Icon 3"`. `link[rel~="icon"]` points at `/favicons/icon-3.svg`.
- **Usage (`set-usage`).** Neither `button "Clear history"` nor `switch "Record searches on this device"` is shown. When the pause is lifted, Clear history has no confirmation; it toasts `Armor usage history cleared` and sends `DELETE /api/build-usage`.
- **Sync (`set-sync`).** Click `button "Add a link"`. In `dialog "Add a link"`, fill `textbox "URL"` with `https://example.com/verify-d2` and `textbox "Name"` with `verify-d2 link`, then click `button "Add link"`. `PUT /api/settings/links` is sent with `{ value: [{ url, name, id }] }`, the stub stores one link, and `region "Links"` shows `link /verify-d2/`.
- **Proof.** `01-settings`, `02-theme-normal`, `03-link-form`, `04-link-added`.

## Gotchas

- Theme and site icon are local only (`stat-builder:app-theme`, `stat-builder:site-icon`). They never touch `/api/settings`; use links or pinned sets to prove sync.
- Toasts are `dialog`s named by their title. A search for "a dialog about clearing" finds the toast.
- Settings pushes are debounced 500 ms. Wait for the `PUT` (`stub.last("PUT", "/api/settings/")`); don't sleep.
- `/api/settings/<key>` accepts only `links`, `pinnedSets` and `activitySets`, each holding an array. Anything else gets 404 or 400 from the stub, as it would from the real route.
