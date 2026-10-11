# Optimizer property-test discovery — shared worker brief

Discovery branch: `t3/optimizer-proptest-praxis` (base commit b2412b4, = origin/main 8c1cb4f + fast-check devDependency).

## Setup in your worktree
- If `node_modules` is missing: `ln -s /Users/noey/.t3-fork/worktrees/d2-stat-builder/t3-debe96a3/node_modules node_modules`
  (fast-check is installed there). Confirm `git log -1` includes b2412b4 ("Add fast-check…"); if not, `git cherry-pick b2412b4`.
- Run tests with `./node_modules/.bin/vitest run <path>`. `python3`/`npx` are broken on this machine (Xcode stub) — use node / ./node_modules/.bin.
- NEVER run prettier --write. Do not touch files outside `src/lib/optimizer/discovery/` and `docs/proptest/` except for TEMPORARY
  mutation experiments, which you must revert (`git diff -- src/lib/optimizer/*.ts` must be empty when you finish).

## Target
`src/lib/optimizer/` — solve.ts (DFS branch-and-bound top-N), bounds.ts (dedupe + suffix/admission/joint-min bounds),
tuning.ts (per-leaf tuning + mod search, assignMods, artifice dump), ceilings.ts (per-stat binary-search probes),
power.ts (power-range tracker), carryover.ts, session.ts, optimizer-store.ts. Background: docs/optimizer-review-2026-09-21.md.
Existing harnesses to reuse ideas/code from (do not rewrite them): completeness-oracle.test.ts (independent exhaustive oracle),
bound-admissibility.test.ts, tuner-exhaustive.test.ts. You may copy the oracle into a discovery module and extend it.

## Product policy — NOT bugs
- Balanced Tuning (tuneOpts[0]) is tried first; directionals only to bridge a minimum.
- Stat mods only cover targets; leftover ordinary mods are not dumped into the total; leftover artifice IS dumped.
- Top-N order and ties are policy (which representative/tie wins is not a bug).
- Gear power = floor(mean) over known-power pieces + given weapons; powerless live armor has power 0 (counts); unknown (undefined) is excluded.
- A time-capped run with honest inexact ceilings is fine (ceilings achievable ≤ truth ≤ uppers, exact ⇔ equal).
- Dedupe keeps one representative per equivalence class — but merging must never change feasibility, totals, ceilings, or constraint satisfaction.
Anything else ambiguous → report it as a QUESTION, don't invent a spec.

## Contracts worth checking (from code docs)
- Every returned loadout is legal (≤1 exotic, exotic mode, set reqs, power range, tuning legality, mod budgets) and its
  bonuses reconstruct stats/total (see checkLoadout in completeness-oracle.test.ts).
- Feasibility: ≥1 loadout iff a legal assignment exists (independent oracle).
- Uncapped run: the top-N totals equal the top-N of the policy totals over ALL legal combos (pruning must be invisible).
- ceilings[s] ≤ true per-stat max (subject to the OTHER five minimums) ≤ ceilingUppers[s]; ceilingsExact ⇔ all equal.
- Timeouts never become disproofs; `capped:false` means the walk was exhaustive.

## Budgets
Wall-clock budgets (performance.now). Use generous budgets (e.g. 20_000 ms) or stub performance.now (vi.spyOn(performance, "now"))
so nothing flakes. Default runs of each discovery file should finish in < ~60 s; gate heavier runs behind `PROP_RUNS` env var
(e.g. `numRuns: Number(process.env.PROP_RUNS ?? 200)`). Use fast-check (`import fc from "fast-check"`) with seeds printed on failure;
deterministic mulberry32 (test-rng.ts) generation is fine too.

## Deliverables
1. Test files under `src/lib/optimizer/discovery/` (shared generators/oracle in a `.ts` helper there), committed on your worktree branch.
   Tests that expose a real bug should stay in the file but be marked `test.fails` or `test.skip` with a comment pointing to the finding,
   so the discovery suite runs green otherwise.
2. A final report: branch name + commit sha; what you built; generator coverage stats you measured (e.g. % feasible, % with power range,
   # set reqs, % capped, how often the interesting path was hit); mutation-testing results (which deliberate defects your harness caught/missed);
   and for every FINDING: minimal deterministic repro (literal input + expected vs actual), the violated contract, root-cause hypothesis
   with file:line, and whether it's a confirmed contract violation, a policy question, or a harness artefact. Don't write production fixes.
