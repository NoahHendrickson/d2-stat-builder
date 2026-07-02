# Legacy Exotics + Artifice +3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit Armor 2.0 exotics into the optimizer pool with full artifice +3 support in the solver, build results UI, and the DIM handoff.

**Architecture:** Artifice is modeled as a third mod class in `assignMods` (each artifice piece in the loadout grants one free +3-to-any-stat resource, outside the shared 5-mod budget). The shared tuning searcher (`createTuningSearcher`) counts artifice pieces per leaf and threads the resource through covering + maximize-dump; solve.ts bounds gain a `3 × artifice-count` slack term so pruning stays admissible for both the top-N search and the ceiling probes. UI adds two toggles (legacy exotics enabled/default-ON; legacy legendaries disabled placeholder), the pool rule admits non-tunable exotics, and the DIM link sockets the picked artifice mods.

**Tech Stack:** TypeScript, Next.js (custom docs in `node_modules/next/dist/docs/` — read before Next-specific work; none expected here), vitest, React.

**Spec:** `docs/superpowers/specs/2026-07-02-legacy-exotics-design.md`

## Global Constraints

- Runtime imports in `src/lib/**` and tests must be RELATIVE — the vitest runner has no `@/` alias; `@/` is allowed only for `import type` (see `vitest-no-path-alias` convention already followed in tuning.ts/selection-storage.ts).
- `src/lib/optimizer/tuning.ts` is the ONE shared tuning search for builds AND ceilings — never fork per-caller logic (a real over-reported-ceiling bug came from drift).
- Pruning bounds must stay ADMISSIBLE (never over-prune a reachable loadout): every bound that gains artifice slack must add it for both chosen and remaining slots.
- The existing test suite must stay green, including the real-pool fixture regression (`solve.test.ts` "real-pool regression").
- Run tests with `npx vitest run <file>` (or `npx vitest run` for all). Lint: `npm run lint` — main has 6 PRE-EXISTING lint errors; do not fix or worsen them, only keep new code clean.
- Deviation from spec (agreed better): NO schema version bump for persistence — add `legacyExotics` as an optional field defaulting to `true`, following the existing `pinnedSets`/`setFilters` optional-field pattern (a version bump would discard every user's stored selections).
- Commit after each task. End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 0: Commit the pre-existing working-tree styling change

`src/components/builder/builder-panel.tsx` has an uncommitted, unrelated styling diff (3D field-surface classes on the set-list settings PopoverTrigger, from this morning's blank-slate registry pull). Commit it separately FIRST so feature commits stay clean.

**Files:**
- Modify: none (commit as-is)

- [ ] **Step 1: Verify the diff is only the styling change**

Run: `git diff --stat`
Expected: only `src/components/builder/builder-panel.tsx | 18 ++++++++++--------`

- [ ] **Step 2: Commit**

```bash
git add src/components/builder/builder-panel.tsx
git commit -m "style: field-surface treatment on set-list settings trigger (pre-existing working-tree change)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: `assignMods` gains the artifice resource

**Files:**
- Modify: `src/lib/optimizer/tuning.ts:122-155` (`assignMods`)
- Test: `src/lib/optimizer/tuning.test.ts`

**Interfaces:**
- Produces: `assignMods(deficits: number[], maxMajor: number, maxMinor: number, maxArtifice = 0)` returning `{ points: number[]; usedMajor: number; usedMinor: number; artificePoints: number[]; usedArtifice: number } | null`. `points` remains major/minor points ONLY; artifice contribution is reported separately in `artificePoints` (multiples of 3). Covering prefers majors, then minors, then artifice (artifice last keeps it available for the maximize dump, which is worth more as +3 total than as redundant covering).

- [ ] **Step 1: Write the failing tests**

Append to the `describe("assignMods", ...)` block in `src/lib/optimizer/tuning.test.ts`:

```ts
  test("artifice: a 3-point deficit is covered by one artifice mod, zero stat mods", () => {
    const out = assignMods([3, 0, 0, 0, 0, 0], 0, 0, 1);
    expect(out).toEqual({
      points: [0, 0, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 0,
      artificePoints: [3, 0, 0, 0, 0, 0],
      usedArtifice: 1,
    });
  });

  test("artifice unlocks a deficit the mod budget alone can't cover", () => {
    // 13 needs 10+3: one major + one artifice. Without artifice it's null (10 < 13, no minors).
    expect(assignMods([13, 0, 0, 0, 0, 0], 1, 0, 0)).toBeNull();
    const out = assignMods([13, 0, 0, 0, 0, 0], 1, 0, 1);
    expect(out).toEqual({
      points: [10, 0, 0, 0, 0, 0],
      usedMajor: 1,
      usedMinor: 0,
      artificePoints: [3, 0, 0, 0, 0, 0],
      usedArtifice: 1,
    });
  });

  test("mods are preferred over artifice when either could cover", () => {
    // One minor (+5) covers the 5-point deficit; the artifice mod stays unspent.
    const out = assignMods([5, 0, 0, 0, 0, 0], 0, 1, 1);
    expect(out).toEqual({
      points: [5, 0, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 0 + 1,
      artificePoints: [0, 0, 0, 0, 0, 0],
      usedArtifice: 0,
    });
  });

  test("backtracking across resources: artifice must move to the stat mods can't reach", () => {
    // Budget: 1 minor + 1 artifice. Deficits [3, 5]: minor must go to stat 1 (5),
    // artifice to stat 0 (3) — a minor-on-0 greedy would strand stat 1.
    const out = assignMods([3, 5, 0, 0, 0, 0], 0, 1, 1);
    expect(out).toEqual({
      points: [0, 5, 0, 0, 0, 0],
      usedMajor: 0,
      usedMinor: 1,
      artificePoints: [3, 0, 0, 0, 0, 0],
      usedArtifice: 1,
    });
  });

  test("infeasible even with artifice", () => {
    expect(assignMods([9, 0, 0, 0, 0, 0], 0, 1, 1)).toBeNull(); // 5+3=8 < 9
  });
```

Note the third test's `usedMinor: 0 + 1` is just `1` — write it as `1`.

Also update the SEVEN existing `assignMods` tests whose `toEqual` now fails on shape: add `artificePoints: [0, 0, 0, 0, 0, 0], usedArtifice: 0` to each expected object (tests at lines 11–74: "zero deficits", "exact major fit", "over-coverage from ceil", "backtracking: greedy major-first", "exact-budget boundary"). The "mixed major + minor" test uses field assertions, not `toEqual` — leave it.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/optimizer/tuning.test.ts`
Expected: new artifice tests FAIL (extra-argument ignored → wrong shape / null), updated old tests FAIL on shape.

- [ ] **Step 3: Implement**

Replace `assignMods` in `src/lib/optimizer/tuning.ts` (keep the doc comment, extend it):

```ts
/**
 * Cheapest assignment of major (+10) / minor (+5) stat mods — plus free artifice (+3)
 * mods from artifice pieces — covering every stat's deficit within the budgets.
 * Covering prefers majors, then minors, then artifice: an artifice mod left unspent
 * here is worth a full +3 to the maximize dump, while a stat mod left unspent is worth
 * nothing (mods are only ever socketed to cover targets). Returns per-stat mod points,
 * artifice points, and counts, or null if infeasible.
 */
export function assignMods(
  deficits: number[],
  maxMajor: number,
  maxMinor: number,
  maxArtifice = 0,
): {
  points: number[];
  usedMajor: number;
  usedMinor: number;
  artificePoints: number[];
  usedArtifice: number;
} | null {
  const major = new Array(NUM_STATS).fill(0);
  const minor = new Array(NUM_STATS).fill(0);
  const artifice = new Array(NUM_STATS).fill(0);

  const rec = (
    s: number,
    majorsLeft: number,
    minorsLeft: number,
    artLeft: number,
  ): boolean => {
    if (s === NUM_STATS) return true;
    const need = deficits[s];
    if (need <= 0) return rec(s + 1, majorsLeft, minorsLeft, artLeft);
    const maxA = Math.min(majorsLeft, Math.ceil(need / 10));
    for (let a = maxA; a >= 0; a--) {
      const afterMajor = need - a * 10;
      const maxC = Math.min(
        artLeft,
        afterMajor > 0 ? Math.ceil(afterMajor / 3) : 0,
      );
      for (let c = 0; c <= maxC; c++) {
        const remainder = afterMajor - c * 3;
        const b = remainder > 0 ? Math.ceil(remainder / 5) : 0;
        if (b > minorsLeft) continue;
        major[s] = a;
        minor[s] = b;
        artifice[s] = c;
        if (rec(s + 1, majorsLeft - a, minorsLeft - b, artLeft - c)) return true;
      }
    }
    major[s] = 0;
    minor[s] = 0;
    artifice[s] = 0;
    return false;
  };

  if (!rec(0, maxMajor, maxMinor, maxArtifice)) return null;
  const points = major.map((a, i) => a * 10 + minor[i] * 5);
  return {
    points,
    usedMajor: major.reduce((x, y) => x + y, 0),
    usedMinor: minor.reduce((x, y) => x + y, 0),
    artificePoints: artifice.map((c: number) => c * ARTIFICE_MOD_BONUS),
    usedArtifice: artifice.reduce((x: number, y: number) => x + y, 0),
  };
}
```

(`ARTIFICE_MOD_BONUS` is already imported at the top of tuning.ts.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/tuning.test.ts`
Expected: PASS (all, including the maximize/feasible property test — it calls `assignMods` only through the searcher, unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/optimizer/tuning.ts src/lib/optimizer/tuning.test.ts
git commit -m "feat(optimizer): assignMods covers deficits with free artifice +3 mods

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Tuning searcher threads artifice through covering + maximize dump

**Files:**
- Modify: `src/lib/optimizer/tuning.ts` (`TuningOutcome`, `createTuningSearcher`)
- Test: `src/lib/optimizer/tuning.test.ts`

**Interfaces:**
- Consumes: Task 1's `assignMods` signature.
- Produces: `TuningOutcome` gains `artificeBonus: number[]` (per-stat points from artifice, covering + dump) and `artifice: (number | null)[]` (per-slot stat pick, aligned to `chosen`; null = piece isn't artifice or its mod went unspent in feasible mode). In maximize mode every artifice piece's +3 is spent (leftovers dump into the stat with the most headroom below the 200 cap); `total` includes the dumped points. Feasible mode spends artifice only for covering.

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/lib/optimizer/tuning.test.ts`. It needs a piece helper — add next to the existing test helpers (the property-test block builds pieces inline via `makeInternalPiece`; mirror that):

```ts
describe("artifice in the tuning searcher", () => {
  const ZERO6 = [0, 0, 0, 0, 0, 0];

  function internal(p: Partial<OptimizerPiece> & { id: string }): InternalPiece {
    return makeInternalPiece(
      { stats: ZERO6.slice(), exotic: false, ...p },
      true,
    );
  }

  /** 5 plain pieces, the first optionally artifice. */
  function loadout(artifice: boolean): InternalPiece[] {
    return [
      internal({ id: "x", artifice, exotic: artifice }),
      internal({ id: "a" }),
      internal({ id: "b" }),
      internal({ id: "c" }),
      internal({ id: "d" }),
    ];
  }

  test("maximize: an artifice piece's +3 is always spent (dump raises total by 3)", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 0, minor: 0 });
    const sum = [10, 10, 10, 10, 10, 10];
    const plain = search(loadout(false), sum, ZERO6.slice(), "maximize");
    const art = search(loadout(true), sum, ZERO6.slice(), "maximize");
    expect(plain).not.toBeNull();
    expect(art).not.toBeNull();
    expect(art!.total).toBe(plain!.total + 3);
    expect(art!.artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
    // Slot 0 is the artifice piece; its pick names the dumped stat.
    expect(art!.artifice[0]).not.toBeNull();
    expect(art!.artifice.slice(1)).toEqual([null, null, null, null]);
  });

  test("feasible: artifice closes a minimum the mod budget alone cannot", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 1, minor: 0 });
    const sum = [10, 0, 0, 0, 0, 0];
    const mins = [23, 0, 0, 0, 0, 0]; // needs 13 over base: 10 (major) + 3 (artifice)
    expect(search(loadout(false), sum, mins.slice(), "feasible")).toBeNull();
    const out = search(loadout(true), sum, mins.slice(), "feasible");
    expect(out).not.toBeNull();
    expect(out!.stats[0]).toBeGreaterThanOrEqual(23);
    expect(out!.artificeBonus[0]).toBe(3);
    expect(out!.artifice[0]).toBe(0);
  });

  test("maximize: dump respects the 200 cap (picks a stat with headroom)", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 0, minor: 0 });
    const sum = [200, 200, 200, 200, 200, 50];
    const out = search(loadout(true), sum, ZERO6.slice(), "maximize");
    expect(out).not.toBeNull();
    expect(out!.artifice[0]).toBe(5); // only stat 5 has headroom
    expect(out!.stats[5]).toBe(53);
  });

  test("no artifice pieces: outcome carries zero artifice fields (regression shape)", () => {
    const search = createTuningSearcher(ZERO6.slice(), { major: 0, minor: 0 });
    const out = search(loadout(false), [10, 0, 0, 0, 0, 0], ZERO6.slice(), "maximize");
    expect(out!.artificeBonus).toEqual(ZERO6);
    expect(out!.artifice).toEqual([null, null, null, null, null]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/tuning.test.ts`
Expected: FAIL — `artificeBonus`/`artifice` undefined on `TuningOutcome`; feasible-mode test gets null with artifice.

- [ ] **Step 3: Implement**

In `src/lib/optimizer/tuning.ts`:

3a. Extend `TuningOutcome`:

```ts
export interface TuningOutcome {
  total: number;
  stats: number[];
  tuningBonus: number[];
  applied: (AppliedTuning | null)[];
  modBonus: number[];
  modsUsed: { major: number; minor: number };
  /** Points each stat gained from artifice +3 mods (covering + maximize dump). */
  artificeBonus: number[];
  /** Per slot: the stat the piece's artifice +3 went to (null = not artifice / unspent). */
  artifice: (number | null)[];
}
```

3b. Rework `createTuningSearcher`'s returned closure. The full replacement of the returned function (the factory's scratch declarations above it stay, with one addition):

Add to the scratch declarations (after `curApplied`):

```ts
  const artificePoints = new Array(NUM_STATS).fill(0);
```

Extend the `Winner` interface:

```ts
  interface Winner {
    total: number;
    modBonus: number[];
    usedMajor: number;
    usedMinor: number;
    applied: (AppliedTuning | null)[];
    tuningBonus: number[];
    artificeBonus: number[];
  }
```

Add two helpers inside the factory (before `makeOutcome`):

```ts
  /**
   * Maximize-mode leftover dump: every unspent artifice mod is worth +3 to the total
   * (artifice is free and piece-intrinsic — it is always socketed in practice), so
   * dump each into the stat with the most headroom below the cap. Mutates `art`
   * in place and returns the total points actually gained after clamping.
   */
  const dumpArtifice = (
    base: number[],
    art: number[],
    leftovers: number,
  ): number => {
    let gained = 0;
    for (let n = 0; n < leftovers; n++) {
      let best = -1;
      let bestRoom = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const room = STAT_CAP - (base[s] + art[s]);
        if (room > bestRoom) {
          bestRoom = room;
          best = s;
        }
      }
      if (best < 0) return gained; // everything capped — stop dumping
      const add = Math.min(ARTIFICE_MOD_BONUS, bestRoom);
      art[best] += ARTIFICE_MOD_BONUS;
      gained += add;
    }
    return gained;
  };

  /** Per-slot artifice picks from the per-stat points: hand stats out to artifice pieces in slot order. */
  const artificeSlots = (
    chosen: InternalPiece[],
    art: number[],
  ): (number | null)[] => {
    const queue: number[] = [];
    for (let s = 0; s < NUM_STATS; s++) {
      for (let n = 0; n < art[s] / ARTIFICE_MOD_BONUS; n++) queue.push(s);
    }
    return Array.from({ length: NUM_SLOTS }, (_, i) =>
      chosen[i].artifice && queue.length ? (queue.shift() as number) : null,
    );
  };
```

Update `makeOutcome` to take `chosen` and carry the artifice fields:

```ts
  const makeOutcome = (
    chosen: InternalPiece[],
    sum: number[],
    w: Winner,
  ): TuningOutcome => {
    const stats = new Array<number>(NUM_STATS);
    for (let s = 0; s < NUM_STATS; s++) {
      stats[s] = clamp(
        sum[s] + frag[s] + w.tuningBonus[s] + w.modBonus[s] + w.artificeBonus[s],
      );
    }
    return {
      total: w.total,
      stats,
      tuningBonus: w.tuningBonus,
      applied: w.applied,
      modBonus: w.modBonus,
      modsUsed: { major: w.usedMajor, minor: w.usedMinor },
      artificeBonus: w.artificeBonus,
      artifice: artificeSlots(chosen, w.artificeBonus),
    };
  };
```

In the returned closure, count artifice up front (first lines of the closure body):

```ts
  return (chosen, sum, mins, mode) => {
    let artCount = 0;
    for (let i = 0; i < NUM_SLOTS; i++) if (chosen[i].artifice) artCount++;
    const maxLeafPoints = maxModPoints + artCount * ARTIFICE_MOD_BONUS;
```

Fast path — pass the artifice budget and dump leftovers (replace the `if (balAsg) { ... }` block):

```ts
    const balAsg = assignMods(deficits, mods.major, mods.minor, artCount);
    if (balAsg) {
      const tuningBonus = new Array<number>(NUM_STATS);
      for (let s = 0; s < NUM_STATS; s++) {
        artificePoints[s] = balAsg.artificePoints[s];
        tuningBonus[s] = aug[s] - sum[s] - frag[s];
      }
      let total = 0;
      if (mode === "maximize") {
        // aug + assigned points as the dump's clamp base.
        for (let s = 0; s < NUM_STATS; s++) deficits[s] = aug[s] + balAsg.points[s];
        dumpArtifice(deficits, artificePoints, artCount - balAsg.usedArtifice);
      }
      for (let s = 0; s < NUM_STATS; s++) {
        total += clamp(aug[s] + balAsg.points[s] + artificePoints[s]);
      }
      return makeOutcome(chosen, sum, {
        total,
        modBonus: balAsg.points.slice(),
        usedMajor: balAsg.usedMajor,
        usedMinor: balAsg.usedMinor,
        applied: curApplied.slice(),
        tuningBonus,
        artificeBonus: artificePoints.slice(),
      });
    }
```

(`deficits` is reused as the dump's base-stats scratch after `assignMods` succeeded — it's dead at that point, and the factory owns it.)

Slow path changes, all inside `rec`:

1. Joint-feasibility prune — artifice breaks the 5-point grain, so only apply the grain when there is no artifice (keeps the old bound's strength intact for the common all-Tier-5 case):

```ts
      let needed = 0;
      for (let s = 0; s < NUM_STATS; s++) {
        const d = mins[s] - (aug[s] + suffixUp[i][s]);
        if (d > 0) {
          needed += artCount === 0 ? Math.ceil(d / 5) * 5 : d;
          if (needed > maxLeafPoints) return;
        }
      }
```

2. Maximize upper bound gains the artifice points:

```ts
      if (mode === "maximize" && w) {
        let ub = maxLeafPoints;
        for (let s = 0; s < NUM_STATS; s++) ub += clamp(aug[s] + suffixUp[i][s]);
        if (ub <= w.total) return;
      }
```

3. Leaf (`i === NUM_SLOTS`) — pass the artifice budget, dump in maximize, include in total:

```ts
      if (i === NUM_SLOTS) {
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = Math.max(0, mins[s] - aug[s]);
        }
        const asg = assignMods(deficits, mods.major, mods.minor, artCount);
        if (!asg) return;
        for (let s = 0; s < NUM_STATS; s++) {
          artificePoints[s] = asg.artificePoints[s];
        }
        if (mode === "maximize") {
          for (let s = 0; s < NUM_STATS; s++) deficits[s] = aug[s] + asg.points[s];
          dumpArtifice(deficits, artificePoints, artCount - asg.usedArtifice);
        }
        let total = 0;
        for (let s = 0; s < NUM_STATS; s++) {
          total += clamp(aug[s] + asg.points[s] + artificePoints[s]);
        }
        if (!box.winner || total > box.winner.total) {
          const tuningBonus = new Array<number>(NUM_STATS);
          for (let s = 0; s < NUM_STATS; s++) {
            tuningBonus[s] = aug[s] - sum[s] - frag[s];
          }
          box.winner = {
            total,
            modBonus: asg.points.slice(),
            usedMajor: asg.usedMajor,
            usedMinor: asg.usedMinor,
            applied: curApplied.slice(),
            tuningBonus,
            artificeBonus: artificePoints.slice(),
          };
        }
        return;
      }
```

4. Final return of the closure:

```ts
    return box.winner ? makeOutcome(chosen, sum, box.winner) : null;
```

- [ ] **Step 4: Run the optimizer test files**

Run: `npx vitest run src/lib/optimizer/`
Expected: ALL PASS — new artifice searcher tests, the maximize/feasible property test, and solve.test.ts untouched behavior (no artifice pieces anywhere in it yet ⇒ identical outcomes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/optimizer/tuning.ts src/lib/optimizer/tuning.test.ts
git commit -m "feat(optimizer): tuning searcher spends artifice +3 mods (covering + maximize dump)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: solve.ts — admissible artifice bounds, dedupe key, result wiring

**Files:**
- Modify: `src/lib/optimizer/solve.ts`
- Test: `src/lib/optimizer/solve.test.ts`

**Interfaces:**
- Consumes: Task 2's `TuningOutcome.artificeBonus` / `.artifice`.
- Produces: `OptimizerLoadout.artificeBonus` / `.artifice` populated from the searcher (no longer zero-filled); ceilings reflect artifice headroom.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/optimizer/solve.test.ts`:

```ts
describe("legacy exotics (artifice +3)", () => {
  /** An artifice legacy exotic: no tuning, free +3 any-stat mod. */
  function legacyExotic(id: string, stats: number[]): OptimizerPiece {
    return { id, stats, exotic: true, hash: 999, artifice: true };
  }

  test("a build's artifice +3 lands in artificeBonus and the piece's slot pick", () => {
    const slots = [
      [legacyExotic("x", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("b", [0, 0, 10, 0, 0, 0])],
      [piece("c", [0, 0, 0, 40, 0, 0])],
      [piece("d", [0, 0, 0, 0, 15, 0])],
    ];
    const out = solve(input(slots));
    expect(out.loadouts.length).toBe(1);
    const lo = out.loadouts[0];
    expect(lo.artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
    expect(lo.artifice[0]).not.toBeNull();
    expect(lo.artifice.slice(1)).toEqual([null, null, null, null]);
    expect(lo.total).toBe(30 + 20 + 10 + 40 + 15 + 3);
  });

  test("artifice closes a minimum the mod budget can't (feasibility, not just total)", () => {
    const slots = [
      [legacyExotic("x", [10, 0, 0, 0, 0, 0]), piece("p", [10, 0, 0, 0, 0, 0])],
      [piece("a", [0, 0, 0, 0, 0, 0])],
      [piece("b", [0, 0, 0, 0, 0, 0])],
      [piece("c", [0, 0, 0, 0, 0, 0])],
      [piece("d", [0, 0, 0, 0, 0, 0])],
    ];
    // Needs 23 weapons: base 10 + major 10 + artifice 3. Non-artifice piece can't.
    const out = solve(
      input(slots, { minimums: [23, 0, 0, 0, 0, 0], mods: { major: 1, minor: 0 } }),
    );
    expect(out.loadouts.length).toBe(1);
    expect(out.loadouts[0].pieceIds[0]).toBe("x");
  });

  test("an artifice piece raises its stat ceiling by 3", () => {
    const mk = (artifice: boolean) => [
      [artifice ? legacyExotic("x", [30, 0, 0, 0, 0, 0]) : piece("x", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("b", [0, 0, 10, 0, 0, 0])],
      [piece("c", [0, 0, 0, 40, 0, 0])],
      [piece("d", [0, 0, 0, 0, 15, 0])],
    ];
    const plain = solve(input(mk(false)));
    const art = solve(input(mk(true)));
    for (let s = 0; s < 6; s++) {
      expect(art.ceilings[s]).toBe(plain.ceilings[s] + 3);
    }
  });

  test("dedupe keeps an artifice piece distinct from a stat-identical plain piece", () => {
    const slots = [
      [
        { id: "plain", stats: [30, 0, 0, 0, 0, 0], exotic: true, hash: 999 },
        legacyExotic("art", [30, 0, 0, 0, 0, 0]),
      ],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("b", [0, 0, 10, 0, 0, 0])],
      [piece("c", [0, 0, 0, 40, 0, 0])],
      [piece("d", [0, 0, 0, 0, 15, 0])],
    ] as OptimizerPiece[][];
    const out = solve(input(slots));
    // If dedupe collapsed them the artifice version could be lost; the best build
    // must carry the +3.
    expect(out.loadouts[0].artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/solve.test.ts`
Expected: the four new tests FAIL (`artificeBonus` all zeros — leaf still zero-fills; ceilings off by 3; feasibility test finds nothing). Existing tests still pass.

- [ ] **Step 3: Implement**

All in `src/lib/optimizer/solve.ts`:

3a. **Dedupe key** (line ~54) — artifice joins the identity:

```ts
    const key =
      (p.exotic ? `E${p.hash ?? 0}` : "L") +
      (p.artifice ? "A" : "") +
      (keyIncludesSet ? `|${p.setHash ?? 0}|` : "|") +
      `T${tuneKey}|` +
      p.stats.join(",");
```

3b. **`computeSuffixBounds`** — add an artifice suffix (count of slots k..4 offering ≥1 artifice piece), computed unconditionally like `setSuffix`:

- Extend the return type with `artSuffix: number[]`.
- Add `const artSuffix = new Array(NUM_SLOTS + 1).fill(0);` beside `exoticSuffix`.
- Inside the `k` loop add:

```ts
    artSuffix[k] = artSuffix[k + 1] + (slots[k].some((p) => p.artifice) ? 1 : 0);
```

(`InternalPiece.artifice` exists since the original scaffolding.)
- Return it: `return { suffixStat, suffixTotal, setSuffix, exoticSuffix, artSuffix };`

3c. **Top-N search (`solve`)** — thread an artifice-chosen counter and widen the three bounds:

- Destructure: `const { suffixStat, suffixTotal, setSuffix, exoticSuffix, artSuffix } = computeSuffixBounds(...)`.
- Beside `let runningTotal = 0;` add `let chosenArt = 0;`.
- `canReachMin` — artifice slack on the joint bound, grain preserved when no artifice is reachable (`artUp` upper-bounds artifice mods available to any completion of this prefix; admissible because each artifice mod yields ≤ +3 points):

```ts
  const canReachMin = (k: number): boolean => {
    const artUp = chosenArt + artSuffix[k];
    const budget = maxModPoints + artUp * 3;
    let needed = 0;
    for (let s = 0; s < NUM_STATS; s++) {
      const d = min[s] - (sum[s] + frag[s] + sumTuneUp[s] + suffixStat[k][s]);
      if (d > 0) {
        needed += artUp === 0 ? Math.ceil(d / 5) * 5 : d;
        if (needed > budget) return false;
      }
    }
    return true;
  };
```

- Top-N admission prune (line ~329) — dumped artifice raises totals, so the bound must include it:

```ts
    if (
      heap.full() &&
      runningTotal +
        suffixTotal[k] +
        maxModPoints +
        (chosenArt + artSuffix[k]) * 3 +
        fragUpside <=
        heap.worst
    ) {
      return;
    }
```

- In the piece loop, maintain the counter symmetrically with `sum` (add after `runningTotal += ...` and mirror in the undo block):

```ts
      if (p.artifice) chosenArt++;
      // ... recurse ...
      if (p.artifice) chosenArt--;
```

- Leaf insert — real values instead of zero-fill:

```ts
          artificeBonus: best.artificeBonus,
          artifice: best.artifice,
```

3d. **`runCeilings`** — same three changes:

- Destructure `artSuffix` from its `computeSuffixBounds` call.
- Add `let chosenArt = 0;` beside its `sum` scratch; increment/decrement around `search(k + 1, nextExotic)` exactly as in 3c (`if (p.artifice) chosenArt++;` / `--`).
- Its `canReachMin` gets the identical artifice form as 3c (with `probeMins` in place of `min`).
- The optimistic bound (line ~549) — without this the binary search's high side is too low and ceilings under-report (the exactness bug class):

```ts
    optimistic[t] = clamp(frag[t] + suffixStat[0][t] + maxModPoints + artSuffix[0] * 3);
```

- [ ] **Step 4: Run the full optimizer suite**

Run: `npx vitest run src/lib/optimizer/`
Expected: ALL PASS, including the real-pool regression (its pool has no artifice pieces ⇒ `artUp === 0` keeps every bound byte-identical to before) and the budget test ("stays within the time budget…").

- [ ] **Step 5: Commit**

```bash
git add src/lib/optimizer/solve.ts src/lib/optimizer/solve.test.ts
git commit -m "feat(optimizer): artifice-aware bounds, dedupe, and results in solve

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Pool rule, artifice wiring, and the two toggles

**Files:**
- Modify: `src/lib/builder/selection-storage.ts`
- Modify: `src/components/builder/builder-panel.tsx`
- Test: `src/lib/builder/selection-storage.test.ts`

**Interfaces:**
- Consumes: `ArmorPiece.isArtifice` / `.isExotic` / `.tunedStat` (normalize.ts, existing).
- Produces: `PersistedSelections.legacyExotics: boolean` (optional in stored blobs, defaults `true`); pool admits `p.tunedStat !== undefined || (useLegacyExotics && p.isExotic)`; `OptimizerPiece.artifice` populated from `isArtifice`.

- [ ] **Step 1: Write the failing persistence tests**

In `src/lib/builder/selection-storage.test.ts`, find the test that round-trips a full `PersistedSelections` blob (look for `saveSelections`/`loadSelections` usage) and add `legacyExotics: false` to its fixture + assertion. Then add:

```ts
test("legacyExotics: missing on old blobs defaults to true; stored value round-trips", () => {
  // Simulate a pre-feature blob: save a valid object, strip the new key.
  const base = validSelections(); // reuse the file's existing fixture helper (adapt name)
  saveSelections(base);
  const raw = JSON.parse(localStorage.getItem(SELECTIONS_KEY)!);
  delete raw.legacyExotics;
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(raw));
  expect(loadSelections()?.legacyExotics).toBe(true);

  saveSelections({ ...base, legacyExotics: false });
  expect(loadSelections()?.legacyExotics).toBe(false);
});
```

Adapt the fixture-helper name to whatever the file actually uses (read the file first); if it builds blobs inline, build one inline here matching its style. TypeScript will also fail compilation everywhere a `PersistedSelections` literal lacks the new required field — that is expected until Step 3.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/builder/selection-storage.test.ts`
Expected: FAIL (type error on `legacyExotics` / `undefined` from parse).

- [ ] **Step 3: Implement persistence**

In `src/lib/builder/selection-storage.ts`:

- Add to `PersistedSelections` (after `allowTuning`):

```ts
  /** Include legacy (Armor 2.0 / non-tunable) exotics in the optimizer pool. */
  legacyExotics: boolean;
```

- In `parse()`, after the `allowTuning` check (follow the `pinnedSets` optional-field pattern — no version bump, missing ⇒ default ON):

```ts
  // Optional (added after v1 shipped) — older stored blobs won't have it.
  const legacyExotics =
    typeof o.legacyExotics === "boolean" ? o.legacyExotics : true;
```

- Add `legacyExotics,` to the returned object.

- [ ] **Step 4: Run persistence tests**

Run: `npx vitest run src/lib/builder/selection-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the builder panel**

In `src/components/builder/builder-panel.tsx`:

5a. Replace the disabled-toggle state (line ~179):

```ts
  // Legacy EXOTICS are supported (artifice +3); legacy legendaries are not yet —
  // that toggle stays disabled.
  const [useLegacyExotics, setUseLegacyExotics] = useState(true);
```

(Remove `useLegacyArmor` entirely.)

5b. Pool rule (line ~228):

```ts
  // Candidate pool for the optimizer: Tier-5 pieces (exactly those with a tuning
  // socket) plus — when enabled — legacy/non-tunable exotics, whose artifice +3 the
  // solver spends. Legacy legendaries stay excluded until supported.
  const pool = useMemo(
    () =>
      classPieces.filter(
        (p) => p.tunedStat !== undefined || (useLegacyExotics && p.isExotic),
      ),
    [classPieces, useLegacyExotics],
  );
```

5c. Restore effect (line ~190): inside `if (saved) {` add `setUseLegacyExotics(saved.legacyExotics);`

5d. Save effect (line ~425): add `legacyExotics: useLegacyExotics,` to the `saveSelections` object and `useLegacyExotics` to the effect's dependency array.

5e. `runOptimizer` piece mapping (line ~463): add `artifice: p.isArtifice,` after `exotic: p.isExotic,`.

5f. Replace the Armor pool section (lines ~882–897):

```tsx
            <Section title="Armor pool">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-sm">Legacy exotics</span>
                    <p className="text-muted-foreground text-xs">
                      Include Armor 2.0 exotics — the optimizer spends their
                      artifice +3 automatically.
                    </p>
                  </div>
                  <Switch
                    checked={useLegacyExotics}
                    onCheckedChange={setUseLegacyExotics}
                    aria-label="Include legacy exotics"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-sm">Legacy legendaries</span>
                    <p className="text-muted-foreground text-xs">
                      Not possible yet.
                    </p>
                  </div>
                  <Switch
                    checked={false}
                    disabled
                    aria-label="Include legacy legendaries (not possible yet)"
                  />
                </div>
              </div>
            </Section>
```

- [ ] **Step 6: Type-check, test, lint**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: tsc clean; all tests pass; lint shows ONLY the 6 pre-existing errors (compare against `git stash`-free main if unsure — do not fix them here).

- [ ] **Step 7: Commit**

```bash
git add src/lib/builder/selection-storage.ts src/lib/builder/selection-storage.test.ts src/components/builder/builder-panel.tsx
git commit -m "feat(builder): legacy-exotics pool toggle + artifice wiring (legendaries placeholder)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: DIM link sockets the artifice mods

**Files:**
- Modify: `src/lib/dim/mod-hashes.ts`
- Modify: `src/lib/dim/loadout-link.ts`
- Modify: `src/components/builder/builder-panel.tsx` (hash memo + prop), `src/components/builder/build-results.tsx` (prop plumbing only)
- Test: `src/lib/dim/loadout-link.test.ts`

**Interfaces:**
- Consumes: `OptimizerLoadout.artifice` (per-slot stat picks) from Task 3.
- Produces: `getArtificeModHashes(manifest): (number | undefined)[]` (STAT_ORDER-indexed); `DimLoadoutInput.artificeModHashes: (number | undefined)[]`; `BuildActionProps.artificeModHashes: (number | undefined)[] | null`.

- [ ] **Step 1: Write the failing DIM-link test**

In `src/lib/dim/loadout-link.test.ts`, find the shared input builder (the file has a fixture with `artifice: [null, null, null, null, null]`) and thread a default `artificeModHashes: []` through it. Add:

```ts
test("artifice picks resolve to artifice mod hashes; missing hash warns and skips", () => {
  const out = buildDimLoadout(
    makeInput({
      loadout: makeLoadout({
        artifice: [0, null, null, null, 4], // +3 weapons on slot 0, +3 super on slot 4
        artificeBonus: [3, 0, 0, 0, 3, 0],
      }),
      artificeModHashes: [7001, undefined, undefined, undefined, undefined, undefined],
    }),
  );
  expect(out.parameters.mods).toContain(7001); // weapons artifice mod
  // stat 4 has no hash — skipped, not crashed
  expect(out.parameters.mods.filter((m) => m === 7001)).toHaveLength(1);
});
```

Adapt `makeInput`/`makeLoadout` to the file's actual helper names (read the file; it defines fixtures near the top at lines ~20–70).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dim/loadout-link.test.ts`
Expected: FAIL (unknown `artificeModHashes` field / mods missing 7001).

- [ ] **Step 3: Implement**

3a. `src/lib/dim/mod-hashes.ts` — append:

```ts
/** Artifice armor's socket-specific +3 stat mods (DIM keys on the same category). */
const ARTIFICE_MOD_CATEGORY = "enhancements.artifice";
const ARTIFICE_BONUS = 3;

/**
 * Per-stat (STAT_ORDER-indexed) plug hashes of the artifice +3 stat mods, scanned
 * from the manifest like the general mods: artifice-category plugs whose investment
 * is a single armor stat worth 3.
 */
export function getArtificeModHashes(manifest: Manifest): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(6).fill(undefined);
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.plug?.plugCategoryIdentifier !== ARTIFICE_MOD_CATEGORY) continue;
    if (def.redacted || !def.displayProperties?.name) continue;

    const inv = (def.investmentStats ?? []).filter(
      (s) => STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined,
    );
    if (inv.length !== 1 || inv[0].value !== ARTIFICE_BONUS) continue;

    const idx = STAT_HASH_TO_INDEX[inv[0].statTypeHash];
    out[idx] ??= Number(key);
  }
  return out;
}
```

3b. `src/lib/dim/loadout-link.ts`:

- `DimLoadoutInput` gains (after `tuningPlugHashes`):

```ts
  /** Per-stat artifice +3 mod plug hashes (STAT_ORDER) from getArtificeModHashes. */
  artificeModHashes: (number | undefined)[];
```

- Destructure it in `buildDimLoadout`, then after the tuning loop (line ~134):

```ts
  for (const pick of loadout.artifice) {
    if (pick === null) continue;
    const hash = artificeModHashes[pick];
    if (hash === undefined) {
      console.warn(`DIM link: no artifice mod hash for stat ${STAT_ORDER[pick]}`);
      continue;
    }
    mods.push(hash);
  }
```

3c. `src/components/builder/builder-panel.tsx` — beside the existing memos (line ~329):

```ts
  const artificeModHashes = useMemo(
    () => (manifest ? getArtificeModHashes(manifest) : null),
    [manifest],
  );
```

Import `getArtificeModHashes` alongside the existing mod-hashes imports and pass `artificeModHashes={artificeModHashes}` where `<BuildResults ... statModHashes={...}>` is rendered.

3d. `src/components/builder/build-results.tsx` — add to `BuildActionProps`:

```ts
  artificeModHashes: (number | undefined)[] | null;
```

Thread it `BuildResults → BuildRow → BuildActions` like `statModHashes`; in `openInDim` add `artificeModHashes` to the `buildDimLoadout` input and guard: `if (!complete || !statModHashes || !tuningPlugHashes || !artificeModHashes) return;` — and add `|| !artificeModHashes` to the DIM button's `disabled`.

- [ ] **Step 4: Run tests + type-check**

Run: `npx tsc --noEmit && npx vitest run src/lib/dim/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dim/mod-hashes.ts src/lib/dim/loadout-link.ts src/lib/dim/loadout-link.test.ts src/components/builder/builder-panel.tsx src/components/builder/build-results.tsx
git commit -m "feat(dim): socket artifice +3 mods in the DIM loadout handoff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Build-results display — artifice pick + breakdown row

**Files:**
- Modify: `src/components/builder/build-results.tsx`

**Interfaces:**
- Consumes: `OptimizerLoadout.artifice` / `.artificeBonus` (Task 3).

- [ ] **Step 1: Implement the pick cell**

Add below `TunedCell` in `src/components/builder/build-results.tsx`:

```tsx
/**
 * The Tuned-column cell for an artifice piece: the picked stat's icon + "+3".
 * Renders nothing for non-artifice pieces (tuning and artifice are mutually
 * exclusive on a piece, so the column is shared).
 */
function ArtificeCell({
  pick,
  statIcons,
}: {
  pick: number | null;
  statIcons: StatIconMap;
}) {
  if (pick === null) return null;
  const key = STAT_ORDER[pick];
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-sky-400/80 tabular-nums">
      <StatGlyph src={statIcons[key]} label={`Artifice +3 ${STAT_LABELS[key]}`} />
      +3
    </span>
  );
}
```

In the per-piece row (line ~292), share the column:

```tsx
                <div className="flex justify-center">
                  {loadout.tuning[pi] ? (
                    <TunedCell
                      tune={loadout.tuning[pi]}
                      statIcons={statIcons}
                      balancedTuningIcon={balancedTuningIcon}
                    />
                  ) : (
                    <ArtificeCell pick={loadout.artifice[pi]} statIcons={statIcons} />
                  )}
                </div>
```

- [ ] **Step 2: Add the breakdown row**

After the "Mods" `BreakdownRow` (line ~315):

```tsx
          {loadout.artificeBonus.some((v) => v > 0) && (
            <BreakdownRow
              label="Artifice"
              render={(i) =>
                loadout.artificeBonus[i] ? (
                  <span className="text-sky-400/80">+{loadout.artificeBonus[i]}</span>
                ) : (
                  ""
                )
              }
            />
          )}
```

- [ ] **Step 3: Type-check + full suite + lint**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: clean tsc, all tests pass, only the 6 pre-existing lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/builder/build-results.tsx
git commit -m "feat(builder): show artifice +3 pick and bonus row in build results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Live verification in the preview

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and load the builder** (preview_start; the app needs Noah's signed-in Bungie session — if the armory doesn't load because auth is missing, note it and verify what's verifiable: toggles render, no console errors).

- [ ] **Step 2: Verify UI** — Armor pool section shows both toggles ("Legacy exotics" on + interactive, "Legacy legendaries" off + disabled) via preview_snapshot; no console errors via preview_console_logs.

- [ ] **Step 3: If signed in:** toggle legacy exotics on, pick a legacy exotic (Armor badge in the table marks artifice pieces), run Find builds, expand a build with a legacy exotic — confirm the +3 pick in the Tuned column, the Artifice breakdown row, and (via the Open in DIM button's URL, intercepted with preview_eval on `window.open` or by inspecting the anchor) that `parameters.mods` includes an artifice hash. This also live-verifies the `enhancements.artifice` manifest category — the one assumption not covered by unit tests; if `getArtificeModHashes` comes back all-undefined against the real manifest, the category id is wrong: check a known artifice mod in the manifest and fix the constant.

- [ ] **Step 4: Screenshot the expanded build for Noah** (preview_screenshot).
