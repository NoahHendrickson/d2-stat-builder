# Weapon search

The `/weapons` view searches the full Destiny catalog without signing in. Its domain logic was ported from `noeyarmory/packages/destiny/src`; the interface uses this app's existing controls. The armor manifest and optimizer do not load the weapon catalog.

## Behavior

- Typo-tolerant name, element, type, rarity, and perk search ("solar hand cannon", "exotic"), with community aliases and `key:value` syntax. Multi-word values use quotes: `perk:"Heal Clip"`.
- Type, element, ammo, slot, rarity, frame, source, season, craftable, and adept filters. Source options are the canonical activity labels the filter matches against.
- Trait 1, trait 2, origin trait, required perks, damage-perk categories, two-trait combinations in separate columns, and custom OR groups (AND between groups). Long perk lists show their first 100 rows until you type.
- Newest, oldest, alphabetical, and ammo-generation sorting. Distinct current perk pools remain separate rows, labelled with the version's source when a name has more than one; superseded definitions stay hidden, following noeyarmory's version reconciliation.
- Shareable URL state, back/forward navigation for filter changes, locally saved searches, and an accessible perk-pool dialog. Selecting a perk starts a reverse perk search.

The port covers searching/filtering and perk inspection. It does not include noeyarmory's DPS spreadsheet integration, weapon build editor, popularity analytics, inventory management, or stat display; the modules and exports that only served those features were removed rather than carried along. Damage-perk classification and curated source labels preserve noeyarmory's rules and require updates when game terminology changes.

## Data and refresh

`public/data/weapons.json` is a committed, compact catalog snapshot, initially ported from noeyarmory and refreshed against Bungie's live manifest on 2026-09-27. Its `version` and `generatedAt` identify the source. Keeping a real snapshot makes clean checkouts and deployments work without requiring a Bungie download during builds.

Run `npm run generate:weapons` with `NEXT_PUBLIC_BUNGIE_API_KEY` in `.env.local` (or `BUNGIE_API_KEY` in the environment) to download the current manifest and atomically replace the snapshot. Review and commit the changed JSON. Failed/incomplete downloads leave the previous snapshot intact. Refreshing is explicit; there is no scheduled synchronization.

`transport.ts` removes duplicated per-weapon names/hashes, per-perk stat modifiers, and the reverse perk index. The browser reconstructs search fields from shared perk references, reducing the initial snapshot from 4.54 MB to about 1.3 MB before compression (roughly 220 KB gzipped). It fetches the catalog only when the weapon view mounts, then shares it through React Query for the page session; `next.config.ts` lets browsers cache `/data/*` for an hour.

## Performance and verification

The catalog builds fuzzy/name indexes and weapon-version fingerprints once. A bounded text-result cache avoids rerunning fuzzy matching when only facets change. Filtering runs before display deduplication, with no early result limit. React defers searches while typing, and TanStack Virtual mounts only visible result rows plus overscan.

- `npx vitest run src/lib/weapons`: ported domain tests and integration checks.
- `npm run bench:weapons`: verifies result parity with the original pipeline across the committed catalog, then compares warm search timings. These are local measurements, not browser latency guarantees.
- `npm test`, `npm run lint`, and `npm run build`: app checks.

Integration changes outside the feature directory are the sidebar entry, bypassing the armor loading overlay on the public catalog route, and the optional `maxVisible` cap on the shared filter multiselect.
