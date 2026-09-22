**Calculation and optimizer review — September 21, 2026**

The existing solver has a good foundation for exact search, but correctness defects should be addressed before further pruning. The largest measured performance cost is traversing armor and tuning combinations. Preserving quality requires independent verification of feasibility, ranking, and ceiling proofs, rather than checking only that a faster version matches today's solver.

This document is a review and proposed implementation plan. No application code or permanent tests were changed. Scope: armor normalization, tuning/mod/stat calculations, loadout search and ceilings, result lifecycle, and saved-loadout totals. This is not a security review or a complete audit of unrelated application features.

**How the current algorithm works**

1. Normalize Bungie armor into masterworked base stats, with socketed modifiers removed and metadata for tuning, artifice, sets, exotics, and power. The builder filters the available pool and converts it to five arrays of optimizer pieces. See [normalize.ts](../src/lib/armory/normalize.ts), [optimizer-pool.ts](../src/lib/armory/optimizer-pool.ts), and [builder-panel.tsx](../src/components/builder/builder-panel.tsx), lines 732–767.
2. Filter incompatible exotics and deduplicate equivalent pieces within each slot. Equivalence depends on active constraints; sets and power distinguish pieces when those constraints apply. Sort candidates by base total. See [bounds.ts](../src/lib/optimizer/bounds.ts), lines 30–69 and 256–282.
3. Walk one piece from each slot using depth-first branch-and-bound. Reject prefixes that cannot satisfy stat targets, shared mod capacity, set requirements, exotic rules, or power. A fixed-size minimum heap keeps up to 200 builds by final total, and an optimistic total bound skips branches that cannot improve the heap. See [solve.ts](../src/lib/optimizer/solve.ts), lines 124–328.
4. For each surviving combination, first try Balanced Tuning everywhere (or no tuning when Balanced is disabled), then allocate target-covering stat/artifice mods. If that fails, search directional tunes. Stat mods are spent to cover targets; unused ordinary mods are not automatically dumped into total. Unused artifice mods are placed to increase total. These are deliberate product policies, not unrestricted maximization over every possible socket choice. See [tuning.ts](../src/lib/optimizer/tuning.ts), lines 209–298 and 320–585.
5. Compute each stat slider's ceiling separately, holding the other five minimums fixed. Binary-search feasibility using the shared tuner and bounds. Reuse achievable lower bounds and proven upper bounds, and harvest feasible builds to improve other bounds when valid. See [ceilings.ts](../src/lib/optimizer/ceilings.ts), lines 114–356.
6. Run in a Web Worker. The initial budgets are 6 seconds for builds and 1.2 seconds for ceilings; background work allows another 15 seconds for ceilings and, when needed, 30 seconds for builds. These are budgeted searches, not an unconditional guarantee of exhaustive completion. The UI freezes the first build list and offers better background results separately. See [session.ts](../src/lib/optimizer/session.ts), lines 11–169.

Quality currently means the top-total shortlist of distinct stat-equivalent representatives under those policies. Sorting that shortlist by a particular stat or upgrade cost does not search for the globally highest stat or cheapest build. Dedupe also intentionally does not preserve every interchangeable item instance. These behaviors should be explicit acceptance criteria before changing search order or equivalence rules.

**Findings, in priority order**

1. **High — valid builds can be rejected by directional-tuning pruning; ceiling proofs can become contradictory. Executed reproduction.**

   [tuning.ts](../src/lib/optimizer/tuning.ts), lines 498–501, captures which stats are short under the initial Balanced configuration. Lines 566–572 then allow a legendary's directional tunes only if its tuned stat was initially short. Replacing another piece's Balanced tune can remove a point from a previously satisfied stat. A compensating directional tune into that stat can be necessary, but the initial short-stat mask forbids it.

   Reproduction: one piece per slot, all five tunable legendary pieces, five major mods, no fragments or additional constraints. Arrays use `[weapons, health, class, grenade, super, melee]`.

   | Slot | Masterworked base stats | Tuned index | Off-archetype indices |
   | --- | --- | --- | --- |
   | Helmet | `[5,20,30,5,5,25]` | 3 | `[0,4,3]` |
   | Arms | `[5,20,5,5,25,30]` | 2 | `[0,2,3]` |
   | Chest | `[30,25,5,20,5,5]` | 5 | `[4,2,5]` |
   | Legs | `[30,5,25,20,5,5]` | 1 | `[1,4,5]` |
   | Class item | `[25,5,30,5,20,5]` | 1 | `[1,3,5]` |

   Targets are `[92,70,148,58,59,65]`. Balanced everywhere gives `[97,77,97,58,63,73]`, so only Class is initially short. A valid solution uses Helmet `+5 Grenade / −5 Health`, Arms `+5 Class / −5 Melee`, Balanced on the other three, and all five major mods on Class. Final stats are `[95,72,151,61,62,68]`, meeting every target.

   The current full `solve()` instead returns zero loadouts, `capped:false`, ceilings `[95,72,151,61,62,68]`, upper bounds `[3,3,151,61,6,7]`, and `ceilingsExact:true`. The ceiling search can find the witness under a different probe minimum, while other probes incorrectly reject valid combinations. Its final exactness check at [ceilings.ts](../src/lib/optimizer/ceilings.ts), lines 351–354, tests only whether any lower bound is *less than* its upper; it does not detect reversed bounds.

   This is a synthetic counterexample executed against the current code, not a claim about a particular live inventory. One-point targets are supported by both the number input and slider ([stat-target-row.tsx](../src/components/builder/stat-target-row.tsx), lines 94–109 and 124–129).

   Plan: repair the feasibility search first; prove any restricted branching rule accounts for losses of Balanced contributions and compensating tunes. Revisit the matching total-upside policy in `makeInternalPiece` whenever branching changes. Enforce `lower <= upper` and exactness iff equality, without hiding contradictions by clamping one bound to the other.

2. **High — Balanced Tuning is overcounted in the saved-loadout editor. Executed reproduction.**

   [editor-stats.ts](../src/lib/loadouts/editor-stats.ts), lines 97 and 106, sums the raw manifest investment stats for Balanced Tuning. Those list six `+1` values, while the normalizer and solver correctly restrict its effect to three off-archetype stats. The editor changes `[30,5,5,20,25,5]` into `[31,6,6,21,26,6]` (96 total), rather than `[30,6,6,20,25,6]` (93 total). Five affected pieces can overstate the total by 15 before caps; `withEditorTotals` persists the result at lines 149–161.

   Bungie's documented rule is that Balanced increases the three lowest armor stats by one. See [Bungie, June 26, 2025](https://www.bungie.net/7/en/News/Article/twid_06_26_2025). This agrees with the project's existing normalization regression; it is not a full validation of every current game mechanic.

   Plan: share the effective tuning-delta calculation across normalization, solver, and editor; carry the base-roll/off-archetype metadata the editor needs. Do not infer those indices from exotic stats after intrinsic bonuses have been added. Resolve each placed plug's effective contribution once and reuse it for both totals and breakdown.

3. **Medium — leftover artifice can be spent for no gain, reducing result quality. Executed reproduction.**

   [tuning.ts](../src/lib/optimizer/tuning.ts), lines 374–386, chooses the stat with the greatest raw room below 200. A stat below zero has the largest room, even when adding three still leaves it below zero. For summed base stats `[25,70,70,70,70,70]`, fragments `[-40,0,0,0,0,0]`, zero targets and one artifice piece, the tuner puts `+3` into Weapons and returns total 350. Putting the same mod into Health returns a legal total of 353. Ordinary mods remain unused under the existing target-covering policy, so this also applies with the builder's five-mod budget.

   Plan: maximize actual clamped gain for artifice placement, accounting for interactions when multiple artifice mods exist. Cover negative values and the upper cap. Separately test whether first-feasible ordinary-mod assignments give the intended ranking near caps; `assignMods` currently finds a feasible major-first covering, not a proof of the best clamped total among all coverings.

4. **High — results can be used with selections from a different query. Confirmed by code tracing; no browser reproduction.**

   [optimizer-store.ts](../src/lib/optimizer/optimizer-store.ts), lines 244–270, keeps the previous result while a new query runs. [builds-column-content.tsx](../src/components/builder/builds-column-content.tsx), lines 169–191, continues rendering it with current subclass props. [builder-panel.tsx](../src/components/builder/builder-panel.tsx), lines 914–933, updates the action getter to current targets and snapshot. [build-actions.tsx](../src/components/builder/build-actions.tsx), lines 143–164 and 191–198, combines those selections with the old loadout for DIM/save. A fragment change followed by Save/Open DIM before the new result, or after cancellation, can produce inconsistent stats and configuration.

   The store also retains old ceiling values at line 265 for incompatible queries, while the slider calls them achievable/proven at [stat-target-row.tsx](../src/components/builder/stat-target-row.tsx), lines 64–67. Setting `exact:false` does not make an old query's value achievable for a new query.

   Plan: bind result lists, bounds, and actions to the immutable query snapshot that produced them. Preserve the existing frozen-list experience, but make its originating configuration authoritative for actions; only present bounds as current when they have valid carryover proof.

5. **Medium — an empty capped search can be presented as proof that no build exists. Confirmed by code tracing.**

   [build-results.tsx](../src/components/builder/build-results.tsx), lines 822–830, uses definitive impossibility wording when refinement is no longer running and no pending list exists, without checking `capped` or `verified`. This includes a background timeout or cancellation.

   Plan: distinguish “none found within the search budget” from a completed infeasibility proof. Exercise empty capped results, cancellation, and completed exhaustive results.

6. **Medium — the build-search time limit is not enforced across all expensive work. Confirmed by code inspection.**

   [solve.ts](../src/lib/optimizer/solve.ts), lines 234–242, checks the deadline only every 65,536 full armor combinations. Work pruning internal nodes, or searching many tuning assignments inside a leaf, can exceed the budget without reaching that checkpoint. Ceiling search checks every 2,048 search nodes, but its tuner call also has no deadline/cancellation result.

   Plan: use amortized node/time checks across both armor and tuning traversal. Propagate an explicit interrupted outcome, distinct from infeasible; never use an interruption to lower a proven upper bound or claim exactness. Preserve or resume the remaining work instead of shrinking the quality budget.

**Measurements and validation performed**

- `npm test`: 54 test files passed, one skipped; **499 tests passed, three benchmark tests skipped**, 47.66 seconds wall time. Passing tests do not cover the demonstrated failures.
- Existing fixture inputs were executed through the current solver with default budgets in Node 24.18.0. TypeScript was transpiled in memory; no harness or generated implementation was written into the project. These are single local observations, not browser p95 or a predicted speedup.

  | Fixture | Raw slot sizes | Elapsed | Combinations tried | Valid combinations visited | Results | Build capped? | Ceilings exact? |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | `realWarlockTwoSetInput()` | `86,79,85,78,74` | 3,169 ms | 739,490 | 2,456 | 200 | No | No |
  | `realWarlockCodaInput()` | `104,92,109,90,101` | 460 ms | 156,859 | 3,222 | 200 | No | Yes |

- Two-set pool deduplication produced `84,79,84,78,73` candidates. Three preparation samples took 0.44–1.38 ms to build slots and 2.19–3.72 ms to calculate suffix bounds.
- A separate V8 CPU sample over two two-set solves and one Coda solve was dominated by armor recursion, ceiling recursion, and directional-tuning recursion: approximately 40%, 33%, and 17% of sampled frames respectively. Sampling/JIT inlining make these directional evidence, not precise attribution of every helper's cost. Garbage collection was not a major sampled cost.
- Direct arithmetic/executable probes reproduced the missed build, contradictory ceiling bounds, Balanced editor inflation, and wasted artifice points. Existing property tests often compare against the production tuner itself: [bound-admissibility.test.ts](../src/lib/optimizer/bound-admissibility.test.ts), lines 131–143, and [tuning.test.ts](../src/lib/optimizer/tuning.test.ts), lines 185–208. They are useful for internal consistency but cannot independently establish the tuner's completeness.
- No authenticated game/profile comparison or browser timing was performed. Missing reusable-plug data and incomplete material definitions remain additional validation cases, not demonstrated live defects. In particular, review [normalize.ts](../src/lib/armory/normalize.ts), lines 520–545, and [masterwork.ts](../src/lib/armory/masterwork.ts), lines 187 and 298.

**Proposed implementation sequence**

1. **Phase 0 — establish the calculation and quality contracts.** Use the current code and fixtures as the API reference; historical `HANDOFF.md` contains outdated descriptions of legacy support and worker ownership. Read the installed Next.js client-boundary guide before UI edits: `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`. Preserve the intended Balanced-first/target-covering-mod policy unless explicitly changed. Record tie behavior, representative-piece equivalence, capped-result semantics, and the distinction between shortlist sorting and a search objective.

   Actual APIs: `solve(input, opts)` with `topNBudgetMs`, `ceilingBudgetMs`, `ceilingSeed`, `ceilingUpperSeed`, `heapSeed`; `runSolveSession(input, callbacks, budgets, carry)`; `solveCeilings(input, seed, budgetMs, opts)`; `computeCeilingCarry(prevInput, prevOutput, nextInput)`. Follow their signatures in `solve.ts`, `session.ts`, `ceilings.ts`, and `carryover.ts`. Do not invent worker protocol fields without updating types and tests.

   Exit check: a written acceptance contract covering valid-build completeness, ranking under the chosen policy, exact ceiling proofs, and unchanged defaults/result count.

2. **Phase 1 — create independent correctness gates and repair the confirmed defects.** Add the demonstrated fixtures first. Build a deliberately simple exhaustive oracle for small pools that enumerates legal piece/tuning/mod/artifice assignments independently of the production pruning, `directionalsBranchable`, and `assignMods`. Test feasibility separately from product ranking policy. Include all six integer targets, negative fragments, caps, exotics, sets, power, tuning toggles, and lower-tier/legacy pieces. Use exhaustive tiny cases plus deterministic randomized cases, rather than attempting large-pool enumeration.

   Repair compensating-tune completeness and any affected total bounds, Balanced editor calculations, artifice clamped gain, and ceiling invariants. Copy the seeded generation and diagnostics patterns from `bound-admissibility.test.ts`; keep that existing production-consistency test alongside the new independent oracle. Extend `editor-stats.test.ts` using the numerical Balanced fixture in `normalize.test.ts:45`. Add normalization → solver → editor → saved-total parity cases, including exotic intrinsic bonuses.

   Exit checks: the reproduced legal build is returned; no ceiling lower bound exceeds its upper; exactness is equivalent to equality; each feasible ceiling has a witness and a claimed exact ceiling cannot be exceeded by the independent oracle. Every result's component bonuses reconstruct its final clamped stats and total. Run all existing tests. Do not preserve a known bug merely to obtain before/after equality.

3. **Phase 2 — preserve query provenance and honest completion state.** Bind outputs/actions to their originating snapshot; invalidate or safely carry displayed bounds; correct empty-result wording; add interruption semantics and reliable budget checks. Reuse fake workers and clocks from `optimizer-store.test.ts:9–52`, the session event collector from `session.test.ts:27–50`, and proof invariants at `session.test.ts:14–25`.

   Exit checks: changing fragments/targets and immediately saving or exporting cannot combine two queries; cancellation leaves honest state; stale worker messages remain ignored; timed-out probes never become infeasibility proofs; large internal-node or tuning walks yield within the chosen scheduling tolerance. Check the pre-dispatch debounce window as well as an active replacement worker. Keep existing frozen-list/pending-offer behavior.

4. **Phase 3 — measure and reduce search work with proven bounds.** Expand `ceilings-bench.test.ts` into repeated warm/cold benchmarks that assert output equivalence, not just log results. Track initial latency, time to proof, p50/p95, visited armor/tuning nodes, prune reasons, capped rate, peak memory, and allocation/GC evidence. Include representative loose, constrained, infeasible, artifice, power, set, exotic, and slider-edit scenarios. Establish a correctness-fixed baseline before comparing optimizations.

   Evaluate these changes individually, retaining only measured wins:

   - Add a cap-aware per-stat upper bound to the existing scalar total bound. The sum of optimistic per-stat clamped values plus remaining modifier allowance can tighten cases where points overflow 200 or fragments reduce a stat. Take the tighter of independently proven bounds. Apply a cheap total-admission gate before expensive leaf tuning; currently the leaf branch runs the tuner before consulting the heap score. Validate each prune against the independent oracle.
   - Consider constraint-aware slot/candidate ordering, such as restrictive exotic/set slots first and pieces closer to target deficits first. This changes traversal, not eligibility. Restore original armor-slot order in output arrays and define deterministic tie handling; compare exact top-N scores and validity, not just first-hit speed. Capped searches can change which results arrive first, so benchmark quality at equal time budgets too.
   - Tighten bounds with relevant exotic/set state when their cost is justified; today's suffix maxima can combine mutually incompatible choices. Test these bounds independently rather than coupling two new pruning rules in one change.
   - Separate score/feasibility evaluation from full output materialization if allocation profiling justifies it. Build result arrays only for heap admissions or ceiling witnesses. If memoizing mod assignment, key by exact deficits and budgets including artifice, keep a bounded cache, and measure key/lookup overhead. Never round away one-point targets or three-point artifice effects.

   Exit checks: exhaustive and randomized oracles still agree on feasibility, ranking policy, and ceilings; all bounds remain admissible; repeated representative benchmarks show an actual speedup without a capped-rate or quality regression. No beam search, random candidate sampling, arbitrary per-slot cutoffs, smaller result limits, or reduced budgets.

5. **Phase 4 — avoid repeated setup and repeated search, in measured priority order.** Reuse immutable prepared slots/tuning options/suffix tables across phases of the same input; `solve` and `runCeilings` currently rebuild suffix bounds, and background entry points repeat preparation. Minimum-dependent `tuneTotalUpside` must be recomputed or safely separated when targets change. This is a small optimization on the measured fixtures, not the main speedup.

   Memoize the builder's `ArmorPiece` conversion across minimum-only edits (`builder-panel.tsx:735–751`). Profile whole-input serialization (`optimizer-store.ts:245`) before replacing it; preserve exact request identity. Consider per-stat carry classification for mixed target edits only after proving it with cold-versus-carried tests in `carryover.test.ts`.

   If repeated background traversal remains significant, introduce a resumable search context that retains the DFS frontier, heap, and proven bounds instead of restarting the walk. This is higher complexity and should follow the smaller improvements. Retain sequence cancellation, query ownership, and result freezing. Avoid expanding to multiple workers or replacing the algorithm before measuring whether simpler exact changes are sufficient.

   Exit checks: no cache reuse across incompatible inventory, tuning, fragments, set, exotic, or power inputs; memory remains bounded; background continuation reaches the same completed answer as a fresh exact solve. Completed/uncapped runs must maintain stable ranking/tie semantics established in Phase 0.

6. **Final verification — prove correctness and measure the delivered result.** Run the full suite, independent oracle, cross-path arithmetic fixtures, lifecycle cases, and repeated benchmark matrix. For implementation changes, run lint and TypeScript checks, then exercise slider edits, cancellation, refinement offers, Save, and DIM export in the browser. Validate selected fresh profile/manifest samples against in-game totals for API-dependent rules; label missing inputs as unknown rather than silently claiming a verified total or zero upgrade cost.

   Report speed changes relative to the correctness-fixed baseline, with result equivalence and uncertainty/capped rates. Retain the current 200-result and search-budget defaults unless a separate product decision changes them. No speedup percentage is promised by this review: the proposed traversal optimizations need measurement after the correctness repairs.
