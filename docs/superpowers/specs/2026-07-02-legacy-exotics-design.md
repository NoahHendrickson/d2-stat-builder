# Legacy (Armor 2.0) exotics in the optimizer

**Date:** 2026-07-02
**Status:** Approved (Noah, 2026-07-02)

## Goal

Let Armor 2.0 exotics into the optimizer pool — exotics only, not legendaries —
including full artifice +3 support in the solver, build results, and the DIM
handoff. Legacy legendaries remain out of scope (a visible-but-disabled toggle
marks them as "not possible yet").

## Mechanics model (confirmed with Noah)

A legacy exotic in a loadout:

- contributes its base stats;
- gets a free **artifice +3 to any ONE stat**, chosen per build, no energy
  cost, outside the shared mod budget;
- can still hold one normal stat mod (+10 major / +5 minor) from the shared
  5-mod loadout budget;
- has **no Tier-5 tuning** (no Balanced, no ±5 directionals).

Not every legacy exotic is guaranteed an artifice slot — the per-piece
`isArtifice` perk detection (`ARTIFICE_PERK_HASH` in
`src/lib/armory/normalize.ts`) is the source of truth. Pieces without the perk
enter the pool but get no +3.

## Pool rule

Candidate pool = Tier-5 pieces (`tunedStat !== undefined`) plus, when the
legacy-exotics toggle is on, **exotics without a tuning socket**
(`isExotic && tunedStat === undefined`). That admits all Armor 2.0 exotics and
also any sub-Tier-5 Armor 3.0 exotic the player owns — neither can tune, only
actual artifice pieces get the +3, and the optimizer picks whichever version
of a same-named exotic builds best (matching the exotic picker's existing
dedupe-by-name behavior).

## Solver: artifice as a third mod class

Artifice is modeled where it behaves like what it is — a loadout-level free
mod resource — in `assignMods` (`src/lib/optimizer/tuning.ts`), NOT as extra
tune options on the piece (which would poison the Balanced-first fast path and
the short-stat directional prune) and NOT as a post-hoc greedy sprinkle (a +3
can replace a minor mod and free budget, so post-hoc under-reports — the same
bug class as the grenade-ceiling incident).

- `OptimizerPiece.artifice` (typed today, never populated) gets wired from
  `isArtifice` in the builder panel's `runOptimizer`.
- The tuning searcher counts artifice pieces among the chosen 5 and passes the
  count to `assignMods`, which gains a third resource: `artifice` mods, each
  +3 to any stat, zero cost, count-limited.
- Maximize mode: leftover artifice mods dump into any non-capped stat
  (+3 total each). Feasible mode: artifice participates in deficit covering.
- `TuningOutcome` gains per-stat `artificeBonus` and the per-slot stat picks;
  these flow into the existing `BuildResult.artificeBonus` / `artifice` fields
  (currently zero-filled in `solve.ts`).
- Pruning stays admissible: the joint mod-budget prune and the per-stat /
  total upside bounds in `solve.ts` each gain `3 × artificeCount` slack. The
  joint prune's ceil-to-5-grain rounding must be revisited (a 3-point resource
  breaks the 5-point grain); use a bound that never over-prunes.
- Ceilings need no separate work: probes share `createTuningSearcher`, so
  artifice headroom flows into ceilings automatically — but the probe seeds /
  bounds in `solve.ts` must include the artifice term for exactness.

The tuning branch-and-bound itself is untouched: legacy exotics carry a single
no-tune option, so there is no branching blowup. At most one artifice piece
per loadout exists today (exotics only), but the model stays general for a
future legacy-legendaries phase.

## UI (builder panel)

The single disabled "Use legacy armor" toggle becomes two:

- **Legacy exotics** — enabled, default ON, persisted with the other
  selections (schema version bump; restore defaults missing value to ON).
- **Legacy legendaries** — disabled, default OFF, helper text "Not possible
  yet".

The exotic picker needs no change (it already dedupes by name across 2.0/3.0
versions and derives from the pool).

## Build results

- The legacy exotic's piece row shows its artifice pick in the Tuned column:
  stat icon + "+3", styled distinctly from tuning entries.
- `artificeBonus` joins the per-stat breakdown alongside mod and tuning
  bonuses.

## DIM link

Alongside the existing major/minor `statModHashes`, scan the manifest for the
six artifice +3 stat-mod plug hashes and push the picked one per artifice
piece into `parameters.mods`. A missing hash degrades to a console warning,
matching the existing mod/tuning paths.

## Testing

- `assignMods` / searcher units: a +3 closes a gap minors can't within
  budget; leftover artifice raises maximize totals; zero artifice pieces →
  byte-identical behavior (regression guard).
- Real-pool fixture regression stays exact (ceilings converge, uncapped).
- Ceiling test: artifice piece raises a stat ceiling by 3 where applicable.
- DIM link test: the artifice mod hash lands in `parameters.mods`.

## Out of scope

- Legacy legendary armor (toggle exists but disabled).
- Auto-socketing artifice mods in the in-app Equip flow (DIM link covers it).
