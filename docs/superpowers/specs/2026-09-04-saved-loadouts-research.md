# Saved loadouts (DIM parity) — research

**Date:** 2026-09-04 · **Branch:** `feat/saved-loadouts` (off `feat/noey-ui-overhaul`) · **Status:** research — no code yet

## Goal

Let a player create, save, manage, and apply loadouts inside d2-stat-builder instead of only
handing a build to DIM. Target: the same functionality DIM's Loadouts feature offers, reached
in phases. This document records what DIM actually does, what the app already has, the gaps,
and the decisions that gate implementation.

Sources: dim-api `api/shapes/loadouts.ts` (the wire shape), DIM `src/app/loadout-drawer/loadout-apply.ts`
(apply pipeline), `src/app/loadout/mod-assignment-utils.ts` (mod placement), DIM's Loadouts wiki,
and `bungie-api-ts` 5.10 (in-game loadout + socket endpoints).

---

## 1. What DIM's loadouts are

### 1.1 Data model (dim-api `Loadout`)

```ts
interface Loadout {
  id: string;                 // client-chosen UUID
  name: string;
  notes?: string;
  classType: DestinyClass;    // 0 Titan · 1 Hunter · 2 Warlock · 3 = any class
  equipped: LoadoutItem[];
  unequipped: LoadoutItem[];
  parameters?: LoadoutParameters;
  createdAt?: number;         // set by the server
  lastUpdatedAt?: number;
}

interface LoadoutItem {
  id?: string;                // itemInstanceId (instanced items)
  hash: number;               // DestinyInventoryItemDefinition hash
  amount?: number;            // consumables
  socketOverrides?: Record<number /*socketIndex*/, number /*plugHash*/>; // subclass abilities/aspects/fragments, weapon perks
  craftedDate?: number;       // re-match reshaped weapons whose instance id changed
}

interface LoadoutParameters {
  statConstraints?: { statHash; minStat?; maxStat? }[];   // minTier/maxTier deprecated post-Edge of Fate
  mods?: number[];            // flat list of armor mod hashes, auto-placed on apply
  perks?: number[];           // desired armor perks (e.g. exotic class item Spirits) — LO input
  setBonuses?: Record<setHash, count>;                     // 2 | 4
  clearMods?: boolean; clearWeapons?: boolean; clearArmor?: boolean;
  modsByBucket?: Record<bucketHash, number[]>;             // fashion: shader/ornament per equipped bucket
  artifactUnlocks?: { unlockedItemHashes: number[]; seasonNumber: number };
  autoStatMods?: boolean;
  query?: string;             // LO item filter
  assumeArmorMasterwork?: 1 None | 2 Legendary | 3 All | 4 ArtificeExotic;
  exoticArmorHash?: number;
  inGameIdentifiers?: { colorHash; iconHash; nameHash };  // for snapshot to an in-game slot
  includeRuntimeStatBenefits?: boolean;
}
```

The app's `DimLoadout` in `src/lib/dim/loadout-link.ts` is already a strict subset of this
shape (equipped armor + fragments carrier, `parameters.mods`, `statConstraints`,
`exoticArmorHash`, `assumeArmorMasterwork: 3`). DIM's URL handoff and its stored loadouts are
the same object.

### 1.2 User-facing feature set (parity checklist)

**Loadouts page / menu**
- List per character class, plus "any class" loadouts.
- Sort by last edited or by name. Search + hashtag pills (hashtags parsed from name/notes).
- Row shows: name, subclass icon, equipped items by bucket, mods, stat totals, notes, missing-item warning.
- Row actions: **Apply**, **Edit**, **Duplicate**, **Share** (dim.gg link), **Snapshot to in-game slot**, **Optimize armor** (reopen LO with `parameters`), **Delete**.
- Auto loadouts in the menu (Max power, Randomize, Item leveling, Make room) — out of scope; not "saved" loadouts.

**Editor (drawer)**
- Name (Destiny glyphs allowed), notes.
- Sections: Subclass (super, abilities, aspects, fragments via `socketOverrides`), Weapons (3),
  Armor (5), General (ghost, sparrow, ship, emblem), Mods (flat list, categorized general /
  slot-specific / activity / artifice / tuning), Fashion (shader + ornament per armor bucket).
- "Fill in using equipped"; double-click toggles equipped ↔ unequipped; undo/redo.
- Settings: clear space / clear other weapons / clear other armor / clear other mods.
- Footer: Save (disabled when no name, duplicate name, or empty), Save as new, Delete, Share.
- Creation path "Snapshot equipped" = new loadout from everything currently on the character.

**Apply pipeline** (`applyLoadout`, phases in order; each item gets a per-phase state)
1. **Dequip** — items equipped on *other* characters must be replaced there first (Bungie
   refuses to transfer equipped items). DIM picks a replacement item automatically.
2. **MoveItems** — `TransferItem` vault↔character hops (two hops when on another character).
3. **EquipItems** — one bulk `EquipItems` call.
4. **SocketOverrides** — subclass abilities/aspects/fragments (missing ability sockets are
   patched with the class default), weapon perks. Uses `InsertSocketPlugFree`.
5. **ApplyMods** — `fitMostMods` chooses which mod goes on which piece (socket type
   compatibility, energy ≤ 10, mutual-exclusion groups, cheapest upgrade cost), then
   `createPluggingStrategy` orders the `InsertSocketPlugFree` calls (remove/swap cheaper mods
   first to free energy). Fashion goes through the same path via `modsByBucket`.
6. **ClearSpace** — move non-loadout items off the character (optional).
7. **InGameLoadout** — `EquipLoadout` when the user applied an in-game slot instead.

Rules: `InsertSocketPlugFree` needs only the **MoveEquipDestinyItems** scope (the one the app
already has, since Equip works), but the character must be in orbit, a social space, or
offline; Bungie asks for ≥0.5 s between plug actions. Error `DestinyCannotPerformActionAtThisLocation`
(1671) is surfaced as "in activity" rather than failing the whole apply.

**In-game loadouts** (component 206 `CharacterLoadouts`)
- Up to `DestinyLoadoutConstantsDefinition.loadoutCountPerCharacter` (10) slots per character,
  unlocked by Guardian Rank. Each slot: `nameHash` / `iconHash` / `colorHash` (tiny manifest
  tables `DestinyLoadoutName/Icon/ColorDefinition`) + `items[{ itemInstanceId, plugItemHashes }]`.
- Endpoints: `SnapshotLoadout` (captures whatever is *currently equipped* into a slot),
  `UpdateLoadoutIdentifiers`, `EquipLoadout`, `ClearLoadout`. DIM "saves to in-game" by
  applying the DIM loadout first, then snapshotting.

**Storage / sync** — DIM keeps loadouts in its own backend (dim-api, Postgres) keyed by Bungie
membership id, with a local cache; that is what gives cross-device sync and short share links.

---

## 2. What the app already has

| Capability | Where | Status |
|---|---|---|
| DIM-shaped loadout object for a build (armor ids+hashes, fragments carrier, stat mods, tuning plugs, artifice mods, stat constraints, exotic, MW assumption) | `lib/dim/loadout-link.ts` `buildDimLoadout` | ✅ |
| Plug-hash lookups: general stat mods, directional tuning, artifice | `lib/dim/mod-hashes.ts` | ✅ |
| Subclass item hashes + fragment socket start per subclass | `lib/dim/subclasses.ts` | ✅ (hardcoded; subclass defs are dropped from the cached manifest) |
| Transfer + bulk equip up to 5 armor pieces on a character | `api/bungie/equip/route.ts`, `lib/bungie/equip-plan.ts`, `lib/bungie/equip-client.ts` | ✅ (MoveEquipDestinyItems scope granted) |
| Live sockets (305), instances/energy (300), reusable plugs (310), equipment (205) in the profile fetch | `api/bungie/profile/route.ts` | ✅ — everything needed to compute socket indices / energy for mod apply is already downloaded |
| Equipped subclass + fragment plugs per character | `lib/armory/equipped-subclass.ts` | ✅ (fragments only) |
| Versioned localStorage persistence pattern with defensive parse | `lib/builder/selection-storage.ts`, `lib/armor-table/*-storage.ts` | ✅ pattern to copy |
| IndexedDB via `idb` | `lib/manifest/db.ts` | ✅ (manifest only) |
| Identity: Bungie membership id in an httpOnly cookie, `/api/auth/session` | `lib/bungie/session.ts` | ✅ — a server store could key on it |
| Default loadout naming, set abbreviation | `loadout-link.ts` | ✅ |
| Weapons / ghost / sparrow / ship / emblem in inventory or manifest | — | ❌ manifest filter keeps armor + mods + plugs only; normalize keeps `itemType === 2` |
| Subclass aspects / abilities / super defs | — | ❌ `itemType 16` dropped from the manifest cache |
| Any server-side database | — | ❌ none; deploy target is Vercel |

Takeaway: the *save* half is mostly a persistence + UI job because the loadout object already
exists per build. The *apply* half is one new phase (socket plugs) on top of the existing
equip route. Weapons/general/fashion are a data-ingestion project.

---

## 3. Gap analysis by cost

### Cheap — data already flows
- Save a build from `BuildRow` as a named loadout (armor + mods + tuning + artifice + fragments + stat constraints + exotic hash + set bonuses).
- Loadouts page (`/loadouts` tab in `HeaderNav`): list, class filter, sort (edited / name), text + hashtag search, notes.
- Row actions that reuse existing code paths: **Equip armor** (`/api/bungie/equip`), **Open in DIM** (`buildDimLoadoutUrl`), **Copy item IDs**.
- Edit name/notes, duplicate, delete.
- **Load in builder** ("Optimize armor" analog): restore targets from `statConstraints`, exotic from `exoticArmorHash`, set requirements from `setBonuses`, fragments from the carrier's `socketOverrides`, class from `classType`. Needs a small `BuilderSnapshot` alongside the DIM object for things DIM's `parameters` can't express (major-mod count, tuning toggles, exotic class item Spirit pair, legacy exotics toggle).
- **Share link** without a backend: `/loadouts?import=<url-encoded JSON>` on our own domain (same mechanism DIM uses for `?loadout=`). ~1 KB per loadout, fine for URLs.
- Missing-item handling: resolve `equipped[].id` against the live armory; when absent, render from `hash` via the manifest and flag "missing" (DIM's `ResolvedLoadoutItem.missing`). Synthetic class-item rolls (`isSyntheticClassItemId`) must save hash-only.

### Medium — new Bungie write phase
- **Apply mods** (`InsertSocketPlugFree`, new server route or a `mods` phase in the equip route):
  - Stat mods: `decomposeModBonus` → ≤5 mod hashes → one per piece (Armor 3.0 has one general socket per piece, which is why the optimizer caps at 5). Socket index = the socket whose `DestinySocketTypeDefinition.plugWhitelist` contains `enhancements.v2_general` (socket types + plug sets are already cached).
  - Energy: piece capacity from component 300 minus the energy of plugs already socketed (read `plug.energyCost.energyCost` from each plug def — don't hardcode). If a slot-specific mod blocks the stat mod, either fail that piece with a clear message or offer DIM's `clearMods` behavior.
  - Tuning: socket 11 (`TUNING_PLUG_CATEGORY`); the plug must be in the instance's 310 reusable plugs — already parsed for `tunedStat`.
  - Artifice: socket whose plugs are `enhancements.artifice`.
  - Fragments: `InsertSocketPlugFree` on the equipped subclass instance (id from `characterEquipment`, indices from `FRAGMENT_SOCKET_START`). Sockets beyond the fragment capacity are ignored by Bungie.
  - Sequencing ≥500 ms between plug calls; surface 1671 as "go to orbit". Refetch the armory afterward (`onEquipped` already exists).
- **Snapshot equipped** as a new loadout: read the character's equipped armor + subclass sockets + mods from the profile we already fetch.

### Larger — new data domains
- **Weapons + general items**: keep `itemType 3` (weapons) and the ghost/sparrow/ship/emblem types in `filterInventoryItems`, normalize them from the profile, add a picker UI, and extend the equip route's `items.length <= 5` guard. The item-table filter roughly doubles (weapons are ~half of the remaining defs); IndexedDB can take it but first load gets slower.
- **Subclass aspects / abilities / super**: keep `itemType 16` defs (18 items) — cheap data, but socket layouts differ per subclass and Prismatic, and the picker UI is real work.
- **Fashion** (`modsByBucket`): shader + ornament plugs are already cached (they're plugs); resolution is per equipped item's cosmetic sockets. Mostly UI.
- **In-game loadout slots**: add component 206 to the profile fetch, add the three tiny `DestinyLoadout*Definition` tables + `DestinyLoadoutConstantsDefinition`, and two server routes (`SnapshotLoadout` + `UpdateLoadoutIdentifiers`). Snapshot captures current equipment, so the flow is apply → snapshot.
- **Cross-device sync + short share links**: needs a backend store (see §4).

Any change to `MANIFEST_TABLES` or the item filter must bump the cache key so existing users
re-download; the loader currently trusts a version match and would serve a cache missing the
new tables.

---

## 4. Storage options

| | A. Local only (localStorage / IndexedDB) | B. Hosted DB on Vercel | C. Local-first + optional sync |
|---|---|---|---|
| Infra | none | Neon Postgres (Vercel Marketplace) or Turso; driver + migrations; `/api/loadouts` CRUD; key rows on the cookie's Bungie `membershipId` | both |
| Cross-device | ❌ | ✅ | ✅ |
| Share links | self-contained JSON URL | short id links | both |
| Data loss | clear-site-data wipes it | server-side | resilient |
| Effort | ~1 day incl. tests | +2–3 days (schema, auth on routes, query hooks, conflict rules) | +1–2 days on top of B (merge / last-write-wins) |
| Fits existing patterns | ✅ (`*-storage.ts`, `idb`) | new surface; session cookie already carries the identity a server needs | — |

Recommendation: **A now, behind an async `LoadoutStore` interface** (`list / get / put / delete`)
so B can replace the implementation without touching the UI, and self-contained share URLs so
sharing works without a backend. Prefer IndexedDB (a second `idb` database, not the manifest
one) over localStorage: no 5 MB ceiling to think about, and the API is already async, which
matches a future server store.

---

## 5. Proposed app data model

```ts
interface SavedLoadout {
  id: string;                    // crypto.randomUUID()
  loadout: DimLoadout;           // dim-api shape — the export/share/apply source of truth
  builder?: BuilderSnapshot;     // what DIM parameters can't express; restores the optimizer UI
  createdAt: number;
  updatedAt: number;
}

interface BuilderSnapshot {
  targets: number[]; major: number;
  setReqs: Record<number, 2 | 4>;
  exoticName: string | null; exoticPerks: [number | null, number | null];
  allowTuning: boolean; balancedTuning: boolean; legacyExotics: boolean;
  activeSubclass: Subclass; fragmentHashes: number[];
}
```

Keeping `DimLoadout` verbatim means Open in DIM, share links, and a later dim-api-compatible
import all stay trivial. `BuilderSnapshot` mirrors `PersistedSelections` minus list-display
state (pins, set filters).

---

## 6. Suggested phases

1. **Save + manage (local).** `lib/loadouts/store.ts` (+ tests), `SavedLoadout` schema with
   version, Save button in `BuildActions`, `/loadouts` page with list, sort, search, class
   filter, row expand (same piece breakdown as `BuildRow`), actions: Equip armor, Open in DIM,
   Load in builder, Edit name/notes, Duplicate, Share link, Delete. Import from share URL.
2. **Apply.** New mods phase (stat mods, tuning, artifice, fragments) via
   `InsertSocketPlugFree` with per-phase results; "Apply loadout" replaces "Equip armor" on
   the loadouts page and in `BuildActions`. Snapshot-equipped as a creation path.
3. **In-game slots.** Component 206, snapshot/rename to a slot, list the character's in-game
   loadouts alongside saved ones.
4. **Full editor parity.** Weapons, general items, aspects/abilities, fashion, clear-space
   options, undo/redo. This is the bulk of DIM's editor and needs the manifest/inventory
   expansion first.
5. **Sync (optional).** Swap `LoadoutStore` for a Neon-backed one; short share links.

---

## 7. Decisions (Noah, 2026-09-04)

1. **Storage:** hosted database, must be free. → **Neon Postgres via the Vercel Marketplace**
   (free plan: 0.5 GB, 100 compute-hours/month, compute auto-suspends but resumes on the next
   query; no inactivity pause). Supabase's free tier pauses projects after 7 idle days, which
   is wrong for a hobby app. Rows keyed on the Bungie `membershipId` the session cookie already
   carries; access only through our own `/api/loadouts` routes. Keep the `LoadoutStore`
   interface so tests use an in-memory implementation.
2. **Scope:** armor-centric. Weapons, fashion, general items are out of v1. **Seasonal
   artifact perks are in** as saved data (`parameters.artifactUnlocks`, read from the
   profile's artifact progression) — displayed and diffed against the current unlocks, not
   applied, because Bungie exposes no endpoint that changes artifact unlocks (DIM has the same
   limit).
3. **v1 = save + apply.** Apply includes transfer/equip (existing) plus the new socket-plug
   phase: stat mods, tuning, artifice, and subclass fragments.
4. **Manifest expansion is fine.** The cache is keyed on Bungie's manifest version, which
   Bungie bumps roughly weekly anyway, so users already re-download at that cadence; adding
   tables or widening the filter just needs a cache-key bump so the next load refetches once.
