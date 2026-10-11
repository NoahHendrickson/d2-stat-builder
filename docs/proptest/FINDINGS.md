# Optimizer property-test discovery — findings and state (2026-10-11)

Branch `t3/optimizer-proptest-praxis`. Suite: `src/lib/optimizer/discovery/` (fast-check is a devDependency here only).

## Run it
- Default (~45 s): `./node_modules/.bin/vitest run src/lib/optimizer/discovery`
- Heavier: `PROP_RUNS=1000` (most files), `PROP_SEED=…`, `PROP_VERBOSE=1`.
- Constraint survey (unsteered, tabulates coverage + violations): `SURVEY=1 PROP_RUNS=30000 PER_SLOT=4 vitest run …/survey.test.ts --silent=false`
- Store model: `PROP_GATES=strict PROP_ADV=1 PROP_COVERAGE=1 vitest run …/optimizer-store.model.test.ts`
- Mutation drivers (always restore the source): `node src/lib/optimizer/discovery/mutate.mjs [regex]`, `mutate-store.mjs`, `mutate-time-honesty.mjs`.

## Harnesses
| File | What it checks |
| --- | --- |
| constraint-oracle.ts / check-case.ts / constraint-oracle.test.ts | Independent exhaustive oracle + power ranges, 0–3 set reqs, multi-hash specific exotics, single-field twin pieces; feasibility, legality, reported power, ceilings (incl. infeasible queries), small-N top-N vs all-combo policy totals (raw and deduped) |
| prune-harness.ts / prune-admissibility.test.ts | Every prefix prune in solve/ceilings walks vs brute force (feasible + maximize), power tracker exactness, end-to-end |
| time-oracle.ts / time-honesty.test.ts | Fake `performance.now` landing timeouts on chosen walk/tuner/probe calls; honesty of capped/inexact results, seeds, heapSeed, session, carry |
| carry-harness.ts / carryover.prop.test.ts / session.prop.test.ts | Edit chains (~40 edit kinds) → carry soundness vs oracle, same-query metamorphic, session protocol + verified/better semantics |
| store-harness.ts / optimizer-store.model.test.ts | Model-based op sequences over the store with fake workers, stale/late messages, errors, fake timers |
| metamorphic-gen.ts / leaf-gen.ts / metamorphic-*.test.ts | 15 solve relations (order, duplication, slot/stat permutation, add/remove piece, relaxation, prefix, toggles, seeds, budgets) + tuner/assignMods vs rule-level brute force |

## Confirmed and fixed (draft PRs)
- **F1** (#52, `fix/ceiling-floor-below-zero`): `raiseAchievableFloors` added spare mods to a stat clamped up from below 0 → ceilings over-reported, sometimes certified exact; dev invariant throw.
- **F2/F3** (#53, `fix/dedupe-key-collisions`): dedupe key merged set 0 with "no set", and a Balanced-only exotic with its directional twin. Not reachable from the app today.

## Pinned as `test.fails` / open questions (no PR)
- **T1** (metamorphic-findings): leaf maximize total depends on piece order when a −5 is absorbed by the 0-clamp (280 vs 285). Is the intended answer "directionals only where needed" or "max over all"?
- **Q2**: ranking total depends on stat index order via first-found `assignMods` covering (overshoot counts in the total).
- **Store** (optimizer-store.model.test): onerror keeps a dead worker (likely real); retry after refinement error re-attaches; stale-worker onerror not ignored; onerror after done clears the offer; A→B→A keeps the old origin on A's list; ceilings message after an exact final inherits `exact`; `now` defaults to Date.now.
- **N1** NaN progress with `topNBudgetMs: 0`; **N2** `maxResults: 0` throws. Unreachable from current callers.
- `beats()` counts a longer list as strictly better (capped first pass with < maxResults builds).
- Docs: ceilings.ts:117 "infeasible query yields zeros" is wrong (code returns per-stat max under the other five mins); types.ts `verified` comment vs final post after an offer.
- Exotic dedupe key `E${hash ?? 0}` merges "no hash" with hash 0 (unrealistic).
- `upperSeed` below the truth but ≥ seed throws in dev (outside the trust contract; no caller produces it).

## Blind spots / next leads
- The top-N walk's 65,536-node budget check is never reached by oracle-sized pools.
- Real-pool-scale correctness relies on metamorphic relations, not an oracle.
- Possible bound tightenings (not bugs): minLoss cap end, artifice term in zeroClampSlack's fromMin.
- dream.ts / weapon-plan.ts were only read, not property-tested.
