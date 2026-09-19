# Thermonuclear review: `feat/saved-loadouts`

**Verdict: not approved.**

The loadout domain layer (`apply-plan`, the parser, the store) is the part that feels designed. The UI and the builder snapshot around it are still carrying two generations of the same feature, and the working tree is about to push that further.

This review covers `feat/saved-loadouts` vs `main`, including uncommitted work. PR: https://github.com/NoahHendrickson/d2-stat-builder/pull/29

---

## 1. Dual editors — delete the old stack

`LoadoutEditorDrawer` is the real save/edit UI. `LoadoutDetailsDialog` + `LoadoutModsEditor` is the previous one, still documented as shared by Save / Edit / Import.

Import is the only remaining caller, and it never passes `mods`. So `LoadoutModsEditor` is dead on the live path, while name / notes / energy / subclass-valid / submit are implemented twice.

That is leftover architecture, not a second use case. Import should use the drawer (or a name-only dialog). Then delete `LoadoutModsEditor` and the dialog form. Keep `KIND_LABEL` where the drawer already lives.

---

## 2. Two stat totals, and they disagree

The drawer now live-sums armor + placement + fragments via `sumEditorStats`. The sidebar card still renders `optimizer.stats`.

On save, `withLoadoutSubclass` only patches that snapshot for a fragment delta:

```ts
{ id, data: withLoadoutSubclass(next, subclass, manifest,
  dialog.mods?.pieces[0]?.stats.map((_, i) => dialog.mods!.pieces.reduce((sum, piece) => sum + piece.stats[i], 0)),
) }
```

Place a real armor mod in the editor and the header updates; the card does not. `withLoadoutSubclass` is doing three jobs (DIM carrier, builder snapshot, derived optimizer totals) and still missing placement.

The simpler model: **stop treating `optimizer.stats` as display truth after edit.** Recompute on read (the new `sumEditorStats` path), or rebuild the whole breakdown on save. Do not keep both.

---

## 3. `BuilderSnapshot` is a second `PersistedSelections`

`dreamersBond` / `festivalMasks` were copied into selection storage, the snapshot type, the parser, load-in-builder, and builder panel state. That will happen again for every new builder flag.

`BuilderSnapshot` is `PersistedSelections` minus pins / set filters, plus one subclass’s fragments. `selectionsForLoadout` exists because the shapes drifted.

Pick one persisted builder-state type (or a typed omit). “Load in builder” should be a field copy, not a translator that has to know about every new toggle.

---

## 4. Slot constraints bolted onto `builder-panel` as fighting booleans

`builder-panel.tsx` was already **1167 lines on main, 1380 now**. The working tree adds two more flags, each with persist / restore / snapshot / exotic-clear effect / onChange / pool branch.

Two `useEffect`s then fight the exotic picker:

- Dreamer's Bond on → drop class-item exotic
- Festival masks on → drop helmet exotic
- Exotic class item on → drop Dreamer's Bond
- Helmet exotic on → drop festival masks

That is spaghetti growth in a file that was already over the 1k line. A slot-source model (`classItem: "pool" | "dreamers"`, `helmet: "pool" | "festival"`) makes the mutual exclusion the data, not a mesh of effects.

Do not grow this file further until the panel is split (targets / sets / exotic / constraints).

---

## 5. Files crossing or sitting on the 1k-line line

| File | Main | Now | Working tree |
|---|---|---|---|
| `builder-panel.tsx` | 1167 | 1380 | +111 |
| `build-results.tsx` | 833 | **1065** | |
| `loadout-editor-drawer.tsx` | — | 980 | **will cross 1k** |
| `loadout-row.tsx` | — | 839 | |
| `loadouts-list.tsx` | — | 758 | |

`build-results` crossed 1k on this branch. `StatGlyph` now lives there and is imported by loadout row + editor — loadouts should not depend on the optimizer results tree for a 20-line glyph.

Decompose before adding the live stats row to the drawer:

- `StatGlyph` + Bungie icon helpers → a shared glyphs module
- `PiecePanel` / `KindGrid` / `ModCell` → their own file
- `LoadoutRow` expanded breakdown + apply + chip row → not one 800-line “row”

---

## 6. Subclass plugs extracted three different ways

`selectedSubclassPlugs` already exists. `resolveLoadout` reimplements it as inner `hashesIn`. `applySavedLoadout` filters `socketOverrides` again to build `SubclassPlugGroup`s.

`SubclassPlan` still has the legacy fragment fields **and** optional `groups` (“absent for legacy fragment-only callers”). That dual API should die. One group list. One helper that slices overrides by socket range. Resolve, apply, and the editor all call it.

---

## 7. Skip reasons are a string protocol

The planner emits parallel `skipped: string[]` and `unplaced: number[]`. The editor then peels `"Name: reason"`:

```ts
mods?.unplaced.forEach((hash, i) => {
  // ...
  const message = mods.skipped[i] ?? "";
  const prefix = `${option.name}: `;
  const reason = message.startsWith(prefix)
    ? message.slice(prefix.length)
    : "not enough armor energy";
```

That only works because editor plans omit subclass. Apply plans mix subclass skips into the same array. Return `{ hash?, reason }` (or split armor vs subclass). Stop parsing English.

---

## Smaller, still real

- **Four icon components** (`ItemIcon`, `PlugIcon`, `ManifestIcon`, `ModIcon`) doing the same Bungie-image-or-muted-square. After `LoadoutModsEditor` goes away, one helper is enough.
- **`save-loadout-drawer.tsx` setState during render** when `session` changes. That’s a React anti-pattern; key the picker off `session` or use an effect.
- **Module-level `dismissedImportParam`** in `loadouts-list.tsx` — process-global mutable UI state because the sidebar remounts. If remount is the problem, lift the dismissal, don’t hide it in a `let`.
- **Duck-typed `DefLookup` / `SuperSocketLookup`** are near-copies of “the Manifest fields I needed today.” Fine for tests; they are drifting independently (`abilitySocketIndex` vs `hashesIn` empty-plug rules already differ).
- **Working tree scope.** Dreamer's Bond / FotL belong with builder constraints. Deleting the drops feed, sidebar logo, button/tabs tweaks do not. Don’t land them in the same “saved loadouts” review pass.

---

## Bottom line

The lib split (plan / place / parse / store / apply stream) is the right shape. The code-judo is to make the UI and the snapshot sit on that shape instead of keeping the previous dialog, a second stats total, a cloned builder blob, and a 1.3k-line panel that absorbs every new constraint as another boolean.
